import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { COMMAND, VERSION } from "../build-info";
import { runDoctor } from "../cli/doctor";
import { type LiveRunner, liveHookCommand } from "../cli/live-check";
import { cliPaths } from "../cli/paths";
import { runRestore } from "../cli/restore";
import { runSetup } from "../cli/setup";
import { type GatewayContext, runGateway } from "../gateway/commands";
import { realProbe } from "../gateway/health";
import type { Runner } from "../gateway/service";
import { projectHookSettingsText } from "../hooks/project-wiring";
import { runHookEntry } from "../hooks/run";
import { recordSessionName } from "../hooks/session-name";
import { PROJECT_HOOKS } from "../hooks/specs";

const HELP = `anymodel ${VERSION} - set up and check the anymodel plugin for Claude Code

Usage: anymodel <command> [options]

Commands:
  setup [--dry-run]  Install the launcher in ~/.local/bin and turn on plugin auto-update.
                     --dry-run prints what would change and writes nothing.
  doctor [--live]    Check the install, and the project of the current folder. Exit
                     code 1 when a check fails.
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
                     Remove what anymodel added, and keep everything else: its settings
                     keys, its Markdown blocks, and the files it created (the launcher,
                     the router copy and unit). Each changed file gets a backup first.
                     With the gateway on, it runs in two stages: first everything but the
                     router, which the running sessions still use; after you restart
                     them, again to stop and remove the router (it asks; --yes: without
                     asking). --now: both at once, and every running session fails until
                     it restarts.
  gateway <command>  The AI gateway: status, models, slot, setup, on, off, serve.
                     anymodel gateway --help lists them.
  version            Print the version.
  --help             Print this help.

Paths follow HOME and CLAUDE_CONFIG_DIR.`;

const HOOK_HELP = `Usage: ${COMMAND} hook <${PROJECT_HOOKS.map((spec) => spec.name).join("|")}>

The worktree engine is opt-in per project. To turn it on in a project, give its
.claude/anymodel.json a "worktrees" field, and paste these hooks into its
.claude/settings.json (merge them with any "hooks" it has):

${projectHookSettingsText()}`;

/**
 * The router bundle beside this file (plugin/dist/router.js). Run from the source
 * (src/entries/cli.ts, in tests and development), the built plugin/dist/router.js.
 */
function routerBundle(): string {
  const beside = join(import.meta.dir, "router.js");
  return existsSync(beside)
    ? beside
    : join(import.meta.dir, "..", "..", "plugin", "dist", "router.js");
}

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

const runner: Runner = (cmd) => {
  const result = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe", timeout: 30_000 });
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
  const paths = cliPaths();

  switch (command) {
    case "setup": {
      const unknown = rest.filter((arg) => arg !== "--dry-run");
      if (unknown.length > 0) {
        console.error(`Unknown option: ${unknown.join(" ")}\n\n${HELP}`);
        return 2;
      }
      return runSetup(paths, { dryRun: rest.includes("--dry-run") });
    }
    case "doctor": {
      const unknown = rest.filter((arg) => arg !== "--live");
      if (unknown.length > 0) {
        console.error(`Unknown option: ${unknown.join(" ")}\n\n${HELP}`);
        return 2;
      }
      return runDoctor(paths, process.env, {
        gateway: { bundle: routerBundle(), runner, systemd },
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
        yes: rest.includes("--yes"),
        now: rest.includes("--now"),
        runner,
        systemd,
        confirm: ask,
        probe: realProbe(),
      });
    }
    case "gateway":
      return runGateway(rest, gatewayContext(paths));
    case "version":
    case "--version":
      console.log(`anymodel ${VERSION}`);
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
  console.error(`anymodel: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
