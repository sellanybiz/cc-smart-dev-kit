import { existsSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../build-info";
import { runDoctor } from "../cli/doctor";
import { cliPaths } from "../cli/paths";
import { runRestore } from "../cli/restore";
import { runSetup } from "../cli/setup";
import { type GatewayContext, runGateway } from "../gateway/commands";
import { realProbe } from "../gateway/health";
import type { Runner } from "../gateway/service";

const HELP = `anymodel ${VERSION} - set up and check the anymodel plugin for Claude Code

Usage: anymodel <command> [options]

Commands:
  setup [--dry-run] [--no-instructions]
                     Install the launcher in ~/.local/bin, turn on plugin auto-update,
                     and install the plugin's instructions for Claude: a copy in
                     ~/.claude/anymodel/instructions/, imported by a block in
                     ~/.claude/CLAUDE.md. --no-instructions leaves them out (and takes
                     them out when they are there). --dry-run prints what would change
                     and writes nothing.
  doctor             Check the install. Exit code 1 when a check fails.
  restore [--yes] [--now]
                     Remove what anymodel added, and keep everything else: its settings
                     keys, its Markdown blocks, and the files it created (the launcher,
                     the instructions, the router copy and unit). Each changed file gets
                     a backup first.
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
 * The plugin's instructions folder (plugin/instructions), beside dist/. Run from the source
 * (src/entries/cli.ts), the repo's plugin/instructions.
 */
function instructionsFolder(): string {
  const beside = join(import.meta.dir, "..", "instructions");
  return existsSync(beside) ? beside : join(import.meta.dir, "..", "..", "plugin", "instructions");
}

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
      const unknown = rest.filter((arg) => arg !== "--dry-run" && arg !== "--no-instructions");
      if (unknown.length > 0) {
        console.error(`Unknown option: ${unknown.join(" ")}\n\n${HELP}`);
        return 2;
      }
      return runSetup(paths, {
        dryRun: rest.includes("--dry-run"),
        instructions: !rest.includes("--no-instructions"),
        instructionsSource: instructionsFolder(),
      });
    }
    case "doctor":
      return runDoctor(paths, process.env, {
        bundle: routerBundle(),
        runner,
        systemd,
      });
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
