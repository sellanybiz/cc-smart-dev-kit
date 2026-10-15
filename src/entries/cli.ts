import { VERSION } from "../build-info";
import { runDoctor } from "../cli/doctor";
import { cliPaths } from "../cli/paths";
import { runRestore } from "../cli/restore";
import { runSetup } from "../cli/setup";

const HELP = `cc-agentic ${VERSION} - set up and check the cc plugin for Claude Code

Usage: cc-agentic <command> [options]

Commands:
  setup [--dry-run]  Install the launcher in ~/.local/bin and turn on plugin auto-update.
                     --dry-run prints what would change and writes nothing.
  doctor             Check the install. Exit code 1 when a check fails.
  restore            Remove what cc-agentic added, and keep everything else: its settings
                     keys, its Markdown blocks, and the files it created (the launcher).
                     Each changed file gets a backup first.
  version            Print the version.
  --help             Print this help.

Paths follow HOME and CLAUDE_CONFIG_DIR.`;

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
    case "doctor":
      return runDoctor(paths);
    case "restore":
      return runRestore(paths);
    case "version":
    case "--version":
      console.log(`cc-agentic ${VERSION}`);
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
  console.error(`cc-agentic: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
