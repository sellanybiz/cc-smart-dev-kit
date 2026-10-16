import { existsSync, statSync } from "node:fs";
import { uptime } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { runBrowserCheck } from "../browser/check";
import { installPicker, runBrowserMcp } from "../browser/launcher";
import { COMMAND, VERSION } from "../build-info";
import { oldBunRefusal } from "../cli/bun-check";
import { runDoctor } from "../cli/doctor";
import { type LiveRunner, liveHookCommand } from "../cli/live-check";
import { runMigrate } from "../cli/migrate";
import { cliPaths } from "../cli/paths";
import { runRestore } from "../cli/restore";
import { runSetup } from "../cli/setup";
import { runStatusline } from "../cli/statusline";
import { runUpdate } from "../cli/update";
import { runUsage } from "../cli/usage";
import { type GatewayContext, runGateway } from "../gateway/commands";
import { realProbe } from "../gateway/health";
import type { Runner } from "../gateway/service";
import { projectHookSettingsText } from "../hooks/project-wiring";
import { runHookEntry } from "../hooks/run";
import { recordSessionName } from "../hooks/session-name";
import { PROJECT_HOOKS } from "../hooks/specs";
import { ALERT_WORKER_COMMAND, parseAlert, runAlert, spawnRunner } from "../hooks/stop-failure";
import { runJobCommand } from "../jobs/commands";
import { realMemoryFacts } from "../jobs/memory";
import { realMachine } from "../machine/machine";
import { serenaFolder } from "../mcp/serena-context";
import { MCP_VERSIONS } from "../mcp/versions";
import { runSearch } from "../search/command";
import { runSessions } from "../sessions/command";
import { instructionsFolder } from "../setup/instructions";
import { LAUNCHER_NAME } from "../setup/launcher";
import { runWorktrees } from "../worktrees/command";

const HELP = `cc-smart-dev-kit ${VERSION} - set up and check the cc-smart-dev-kit plugin for Claude Code

Usage: cc-smart-dev-kit <command> [options]

Commands:
  setup [--dry-run] [--yes] [--project <dir>] [--warp | --remove-warp]
        [--no-instructions | --instructions] [--statusline]
                     Install the launcher in ~/.local/bin, turn on plugin auto-update,
                     install the plugin's instructions for Claude (a copy in
                     ~/.claude/cc-smart-dev-kit/instructions/, imported by a block in
                     ~/.claude/CLAUDE.md), add the companion plugins' marketplaces, point
                     claude-mem at the gateway's affordable model (when both are there), and
                     copy the project's auto-mode entries into your settings. The entries
                     are trust rules: they are shown and asked on a terminal (--yes:
                     shown, not asked); with no terminal they are left out, also with
                     --yes.
                     --project <dir>: the project to read .claude/cc-smart-dev-kit.json from
                     (default: this folder). --warp: install the Warp terminal (the
                     commands are shown and asked; sudo asks for your password) and its
                     Claude plugin. --remove-warp: take them out again.
                     --no-instructions takes the instructions out and keeps them out: a
                     later plain setup leaves them out too. --instructions brings them
                     back. restore forgets the choice.
                     --statusline also sets Claude Code's status line to
                     "cc-smart-dev-kit statusline" (asked when run in a terminal).
                     --dry-run prints what would change, and writes, runs and checks
                     nothing.
  doctor [--live]    Check the install, the cc-smart-dev-kit files the current project's CLAUDE.md
                     imports, and the project of the current folder. Exit code 1 when a
                     check fails.
                     --live: also run two throwaway Claude Code sessions in temp repos,
                     to prove the hooks and the worktree engine on this Claude Code
                     (uses your login; a few cents). Records the version it passed on.
  hook <worktree-create|worktree-remove|subagent-stop>
                     The worktree engine, for a project that wires it in its own
                     .claude/settings.json: reads the hook's input on stdin and answers
                     as Claude Code expects. Without a name: prints the lines to paste.
  session-name <session id> <name>
                     Name a Claude session after its task (for the session-name hook).
  restore [--yes] [--now]
                     Remove what cc-smart-dev-kit added, and keep everything else: its settings
                     keys and entries (claude-mem's settings, the auto-mode entries), its
                     Markdown blocks, and the files it created (the launcher, the
                     instructions, the router copy and units). Each changed file gets a
                     backup first. Plugins and marketplaces setup added stay installed.
                     With the gateway on, it runs in two stages: first everything but the
                     router, which the running sessions still use; after you restart
                     them, again to stop and remove the router (it asks; --yes: without
                     asking). --now: both at once, and every running session fails until
                     it restarts.
  migrate [--dry-run] [--yes]
                     Move a machine that still has this plugin's old "anymodel" names:
                     its folders, its state folder's records and backups, the settings
                     keys the old setup owned (the slots' names and words), the
                     instructions block in ~/.claude/CLAUDE.md, the gateway config's
                     slots (with an alias for each old name, so running sessions keep
                     working), and the router units. On a 0.2.x machine this command does
                     not exist yet: run the installed plugin's dist/cli.js with bun
                     (README, Moving from anymodel).
                     It reads and checks everything, then asks every question, and writes
                     nothing before they are answered: a "no" leaves the machine as it
                     was. It then prints its steps and walks them; a step that fails keeps
                     what the steps before it did, and running it again goes on from there.
                     Refuses to run inside a Claude Code session: run it in your own
                     terminal, then restart your sessions.
                     --yes: no questions (the router is replaced without asking). The old
                     plugin is uninstalled only after a terminal yes.
  update [--check | --hold | --resume]
                     Install a newer cc-smart-dev-kit now, with the output of each step.
                     --check: only say whether a newer version exists. A new Claude
                     session checks by itself, at most once an hour, and installs it in
                     the background; --hold stops that on this machine, --resume starts
                     it again. Nothing restarts: restart the sessions to load it.
  gateway <command>  The AI gateway: status, models, slot, setup, on, off, serve.
                     cc-smart-dev-kit gateway --help lists them.
  browser <command>  The shared browser. cc-smart-dev-kit browser mcp starts the Playwright
                     MCP server on the ONE Chrome every session shares, through a filter that
                     shows this session only its own windows (setup registers it as the
                     "playwright" MCP server). browser check runs two real sessions on one
                     throwaway Chrome and proves it end to end (--headless: no window).
  sessions [--open] [--dry-run]
                     This project's Claude Code sessions of the last two days, by name and
                     worktree, with the command that resumes each. --open reopens every
                     session that was open when the machine went down or its window closed
                     (Warp tabs, or XFCE Terminal windows on Linux); --dry-run says what it
                     would open and opens nothing.
  worktrees [--clean] [--remove <path>] [--no-fetch]
                     Every worktree of this repo: who works in it, and which are finished
                     (every commit on origin/<base>, nothing uncommitted, no local files, no
                     running session, no program or Docker container using it). --clean
                     removes the finished ones with their branches; --remove <path> removes
                     one now, without the one-hour wait. Both run in the main checkout only.
  job <command>      The queue for heavy jobs (type checks, test runs, builds):
                     run, status, kinds. cc-smart-dev-kit job --help lists them.
  search "<query>" [--max <n>] [--json]
  search --fetch <url> [--json]
                     Search the web through the gateway (OmniRoute, Ollama's web search):
                     each result's title, URL and a short snippet. --fetch: one page's
                     text. The query or URL goes to that provider on the internet. Needs
                     the gateway set up.
  statusline         One line for Claude Code's status bar: plan usage (a warning from
                     85 %), and any fallback the gateway is using. Reads the JSON
                     Claude Code passes on stdin.
  usage [--hours <n>] [--project <folder or name>]
                     Which models answered on this machine, per session: the main
                     session's replies and its subagents' apart (how each subagent was
                     launched, and the share on Opus), from Claude Code's transcripts
                     (default: the last 6 hours). Read only; no message text.
  version            Print the version.
  --help             Print this help.

Paths follow HOME and CLAUDE_CONFIG_DIR.`;

const HOOK_HELP = `Usage: ${COMMAND} hook <${PROJECT_HOOKS.map((spec) => spec.name).join("|")}>

The worktree engine is opt-in per project. To turn it on in a project, give its
.claude/cc-smart-dev-kit.json a "worktrees" field, and paste these hooks into its
.claude/settings.json (merge them with any "hooks" it has):

${projectHookSettingsText()}`;

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
  return basename(import.meta.dir) === "dist"
    ? dirname(import.meta.dir)
    : join(import.meta.dir, "..", "..", "plugin");
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

/** Asks on the terminal; null when stdin is not one (a pipe, a script, a test). */
const ask = process.stdin.isTTY ? (question: string) => confirm(question) : null;

function gatewayContext(paths: ReturnType<typeof cliPaths>): GatewayContext {
  return {
    paths,
    bunPath: process.execPath,
    bunVersion: Bun.version,
    bundle: routerBundle(),
    runner,
    readStdin: () => Bun.stdin.text(),
    confirm: ask,
    systemd,
    probe: realProbe(),
  };
}

async function main(argv: string[]): Promise<number> {
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
      ];
      let project = process.cwd();
      const unknown: string[] = [];
      for (let index = 0; index < rest.length; index += 1) {
        const arg = rest[index] ?? "";
        if (arg === "--project") {
          const dir = rest[index + 1];
          if (dir === undefined || dir.startsWith("--")) {
            console.error(`--project needs a folder\n\n${HELP}`);
            return 2;
          }
          project = resolve(dir);
          index += 1;
        } else if (!flags.includes(arg)) {
          unknown.push(arg);
        }
      }
      if (unknown.length > 0) {
        console.error(`Unknown option: ${unknown.join(" ")}\n\n${HELP}`);
        return 2;
      }
      const off = rest.includes("--no-instructions");
      const on = rest.includes("--instructions");
      if (off && on) {
        console.error(`Use --no-instructions or --instructions, not both.\n\n${HELP}`);
        return 2;
      }
      if (rest.includes("--warp") && rest.includes("--remove-warp")) {
        console.error(`--warp and --remove-warp do opposite things: give one\n\n${HELP}`);
        return 2;
      }
      if (!existsSync(project) || !statSync(project).isDirectory()) {
        console.error(`--project: ${project} is not a folder`);
        return 2;
      }
      return runSetup(paths, {
        dryRun: rest.includes("--dry-run"),
        env: process.env,
        yes: rest.includes("--yes"),
        warp: rest.includes("--warp"),
        removeWarp: rest.includes("--remove-warp"),
        project,
        machine: realMachine(process.env, ask),
        instructions: off ? false : on ? true : null,
        instructionsSource: instructionsFolder(import.meta.dir),
        serenaSource: serenaFolder(import.meta.dir),
        statusline: rest.includes("--statusline"),
      });
    }
    case "statusline":
      // Claude Code pipes its JSON in; run by hand in a terminal, there is none to wait for.
      return runStatusline(
        paths,
        () => (process.stdin.isTTY ? Promise.resolve("") : Bun.stdin.text()),
        Date.now(),
      );
    case "usage":
      return runUsage(paths, rest, Date.now());
    case ALERT_WORKER_COMMAND: {
      // Not in --help: the StopFailure hook starts it, detached, through the launcher, so the
      // half hour it may wait for a click runs from the installed version, not the hook's
      // version folder (src/entries/stop-failure.ts).
      const alert = rest.length === 1 ? parseAlert(rest[0] ?? "") : null;
      if (alert === null) {
        console.error(
          `Usage: cc-smart-dev-kit ${ALERT_WORKER_COMMAND} <alert JSON> (the hook runs it)`,
        );
        return 2;
      }
      const launcher = join(paths.binDir, LAUNCHER_NAME);
      if (runAlert(alert, process.platform, launcher, spawnRunner) === "no notifier") {
        console.error(`cc-smart-dev-kit: ${alert.title}. ${alert.body}`);
      }
      return 0;
    }
    case "doctor": {
      const unknown = rest.filter((arg) => arg !== "--live");
      if (unknown.length > 0) {
        console.error(`Unknown option: ${unknown.join(" ")}\n\n${HELP}`);
        return 2;
      }
      return runDoctor(paths, process.env, {
        bun: { path: process.execPath, version: Bun.version },
        gateway: {
          bundle: routerBundle(),
          runner,
          systemd,
          machine: realMachine(process.env, null),
        },
        local: { instructionsSource: instructionsFolder(import.meta.dir), cwd: process.cwd() },
        mcp: {
          run: (argv, extraEnv) => {
            try {
              const result = Bun.spawnSync(argv, {
                env: { ...process.env, ...extraEnv },
                stdin: "ignore",
                stdout: "pipe",
                stderr: "pipe",
              });
              return {
                ok: result.exitCode === 0,
                output: `${result.stdout.toString()}${result.stderr.toString()}`,
              };
            } catch (error) {
              return {
                ok: false,
                output: error instanceof Error ? error.message : String(error),
              };
            }
          },
          which: (command) => Bun.which(command),
        },
        project: { cwd: process.cwd(), pluginHooksFile: join(pluginDir(), "hooks", "hooks.json") },
        live: rest.includes("--live")
          ? {
              pluginDir: pluginDir(),
              hookCommand: liveHookCommand(pluginDir(), process.execPath),
              run: liveRunner,
            }
          : null,
      });
    }
    case "hook": {
      const [name, ...extra] = rest;
      if (name === undefined || name === "--help" || name === "-h") {
        console.log(HOOK_HELP);
        return 0;
      }
      const spec = PROJECT_HOOKS.find((one) => one.name === name);
      if (spec === undefined || extra.length > 0) {
        console.error(`Unknown hook: ${[name, ...extra].join(" ")}\n\n${HOOK_HELP}`);
        return 2;
      }
      // Reads stdin, answers, and exits with the hook's code.
      return runHookEntry(spec);
    }
    case "session-name": {
      const [sessionId, ...words] = rest;
      if (sessionId === undefined || words.length === 0) {
        console.error(`Usage: ${COMMAND} session-name <session id> <name>\n\n${HELP}`);
        return 2;
      }
      const name = recordSessionName(sessionId, words.join(" "), process.env);
      console.log(`This session will be named "${name}" from the next prompt.`);
      return 0;
    }
    case "restore": {
      const unknown = rest.filter((arg) => arg !== "--yes" && arg !== "--now");
      if (unknown.length > 0) {
        console.error(`Unknown option: ${unknown.join(" ")}\n\n${HELP}`);
        return 2;
      }
      return runRestore(paths, {
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
        systemd,
        confirm: ask,
        probe: realProbe(),
        which: (command) => Bun.which(command),
      });
    }
    case "migrate": {
      const unknown = rest.filter((arg) => arg !== "--dry-run" && arg !== "--yes");
      if (unknown.length > 0) {
        console.error(`Unknown option: ${unknown.join(" ")}\n\n${HELP}`);
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
      if (sub === "mcp") {
        // Runs until the MCP exits. Nothing here may write to stdout: it IS the MCP stream.
        return await runBrowserMcp(paths, extra, {
          installPicker,
          log: (line) => console.error(`[cc-smart-dev-kit-browser] ${line}`),
          package: `@playwright/mcp@${MCP_VERSIONS.playwright}`,
          pickerBundle: distBundle("browser-picker.js"),
          spawn: (argv, options) => {
            const child = Bun.spawn(argv, { stdio: [options.stdio, options.stdio, options.stdio] });
            return { exited: child.exited, kill: (signal) => child.kill(signal) };
          },
          which: (command) => Bun.which(command),
        });
      }
      if (sub === "check") {
        const unknown = extra.filter((arg) => arg !== "--headless" && arg !== "--idle");
        if (unknown.length > 0) {
          console.error(`Unknown option: ${unknown.join(" ")}\n\n${HELP}`);
          return 2;
        }
        // Two real launchers (this CLI), each with a real Playwright MCP, on one Chrome.
        const result = await runBrowserCheck(extra, {
          check: (name, ok, why) =>
            console.log(
              `${ok ? "✓" : "✗"} ${name}${ok || why === undefined ? "" : ` — ${why.slice(0, 400)}`}`,
            ),
          cli: [process.execPath, process.argv[1] ?? ""],
          log: (line) => console.error(line),
        });
        console.log(
          result.failed === 0
            ? `\nAll ${String(result.total)} checks passed.`
            : `\n${String(result.failed)} of ${String(result.total)} checks failed.`,
        );
        return result.failed === 0 ? 0 : 1;
      }
      console.error(`Usage: ${COMMAND} browser <mcp|check> [options]\n\n${HELP}`);
      return 2;
    }
    case "sessions": {
      const unknown = rest.filter((arg) => arg !== "--open" && arg !== "--dry-run");
      if (unknown.length > 0) {
        console.error(`Unknown option: ${unknown.join(" ")}\n\n${HELP}`);
        return 2;
      }
      return await runSessions(
        paths,
        { dryRun: rest.includes("--dry-run"), open: rest.includes("--open") },
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
      if (removeAt !== -1 && removeTarget === "") {
        console.error(`Say which worktree: ${COMMAND} worktrees --remove <path>\n\n${HELP}`);
        return 2;
      }
      const unknown = rest.filter(
        (arg, index) =>
          arg !== "--clean" && arg !== "--no-fetch" && arg !== "--remove" && index !== removeAt + 1,
      );
      if (unknown.length > 0) {
        console.error(`Unknown option: ${unknown.join(" ")}\n\n${HELP}`);
        return 2;
      }
      return await runWorktrees(
        paths,
        {
          clean: rest.includes("--clean"),
          noFetch: rest.includes("--no-fetch"),
          remove: removeTarget,
        },
        process.env,
      );
    }
    case "gateway":
      return runGateway(rest, gatewayContext(paths));
    case "search":
      return runSearch(rest, { paths });
    case "job":
      return runJobCommand(rest, {
        paths,
        cwd: process.cwd(),
        execArgv: process.execArgv,
        memory: realMemoryFacts(),
        say: (line) => console.error(line),
        print: (line) => console.log(line),
      });
    case "version":
    case "--version":
      console.log(`cc-smart-dev-kit ${VERSION}`);
      return 0;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;
    default:
      console.error(`Unknown command: ${command}\n\n${HELP}`);
      return 2;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`cc-smart-dev-kit: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
