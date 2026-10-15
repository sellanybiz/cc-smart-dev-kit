import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { VERSION } from "../build-info";
import { runDoctor } from "../cli/doctor";
import { cliPaths } from "../cli/paths";
import { runRestore } from "../cli/restore";
import { runSetup } from "../cli/setup";
import { type GatewayContext, runGateway } from "../gateway/commands";
import { realProbe } from "../gateway/health";
import type { Runner } from "../gateway/service";
import { realMachine } from "../machine/machine";

const HELP = `anymodel ${VERSION} - set up and check the anymodel plugin for Claude Code

Usage: anymodel <command> [options]

Commands:
  setup [--dry-run] [--yes] [--project <dir>] [--warp | --remove-warp]
                     Install the launcher in ~/.local/bin, turn on plugin auto-update, add
                     the companion plugins' marketplaces, point claude-mem at the gateway's
                     cheap model (when both are there), and copy the project's auto-mode
                     entries into your settings. The entries are trust rules: they are
                     shown and asked on a terminal (--yes: shown, not asked); with no
                     terminal they are left out, also with --yes.
                     --project <dir>: the project to read .claude/anymodel.json from
                     (default: this folder). --warp: install the Warp terminal (the
                     commands are shown and asked; sudo asks for your password) and its
                     Claude plugin. --remove-warp: take them out again.
                     --dry-run prints what would change, and writes, runs and checks
                     nothing.
  doctor             Check the install. Exit code 1 when a check fails.
  restore [--yes] [--now]
                     Remove what anymodel added, and keep everything else: its settings
                     keys and entries (claude-mem's settings, the auto-mode entries), its
                     Markdown blocks, and the files it created (the launcher, the router
                     copy and unit). Each changed file gets a backup first. Plugins and
                     marketplaces setup added stay installed.
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
      const flags = ["--dry-run", "--yes", "--warp", "--remove-warp"];
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
        yes: rest.includes("--yes"),
        warp: rest.includes("--warp"),
        removeWarp: rest.includes("--remove-warp"),
        project,
        machine: realMachine(process.env, ask),
      });
    }
    case "doctor":
      return runDoctor(paths, process.env, {
        bundle: routerBundle(),
        runner,
        systemd,
        machine: realMachine(process.env, null),
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
