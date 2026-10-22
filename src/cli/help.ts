/**
 * The one table of commands, and the help built from it.
 *
 * The top-level help, `help <command>` and `<command> --help` all print from this table, so a
 * command is described in one place and can never drift from another copy (`dynamic.md` § One
 * source per value). Where a command's own module already writes its usage text, the row
 * imports it; where a list is data (the hook names, the status line's warning share, the
 * command's own name), the row reads that data.
 *
 * **Adding a command:** add one row to `COMMAND_HELP` below. Give it `name` (as a person types
 * it: `report`, `workflow merge-check`), `summary` and `listed: "start"` when it belongs in the
 * top-level help's first block, `listed: "more"` when its name alone belongs in the second, and
 * `help`: the text `help <name>` and `<name> --help` print. A command whose own module exports
 * its usage text imports that text for `help`; a command with no module text writes it here.
 * Nothing else needs an entry: the top-level help and the `--help` answer are built from this
 * table. `src/cli/help.test.ts` fails when the dispatcher (`src/entries/cli.ts`) answers a
 * command that has no row.
 *
 * The dispatcher is the only caller: it answers `-h`/`--help` and `help <command>` from here,
 * before any command runs, so help never runs a command and never needs a machine (`UX-2`).
 */
import { COMMAND, VERSION } from "../build-info";
import { CREW_USAGE } from "../crew/command";
import { BOARD_COMMANDS, TELL_USAGE } from "../crew/usage";
import { USAGE as GATEWAY_USAGE } from "../gateway/commands";
import { ALERT_WORKER_COMMAND } from "../hooks/stop-failure";
import { USAGE as JOB_USAGE } from "../jobs/commands";
import { USAGE as OMNIROUTE_USAGE } from "../omniroute/commands";
import { PORTAL_USAGE } from "../portal/command";
import {
  NO_RETRY_WATCHDOG_FLAG,
  RETRY_WATCHDOG_ENV,
  RETRY_WATCHDOG_FLAG,
} from "../setup/retry-watchdog";
import { USER_NOTIFY_HOOK_NAME } from "../setup/user-notify-hook";
import { WORKFLOW_USAGE } from "../workflow/commands";
import { workflowDefaults } from "../workflow/schema";
import { PROJECT_INIT_USAGE } from "./project-init";
import { REPORT_USAGE } from "./report";
import { UPDATE_USAGE } from "./update";

/** The command that prints another command's help: `${COMMAND} help <command>`. */
export const HELP_COMMAND = "help";

/** One command's row in the table. */
export interface CommandHelp {
  /** The command as a person types it: `doctor`, `gateway setup`. */
  name: string;
  /**
   * The one line the top-level help prints for it. Only the "Start here" rows carry one: the
   * "More commands" list shows names alone, so a summary nowhere would be data no one reads.
   */
  summary?: string;
  /**
   * Where the top-level help names it. `"start"`: the "Start here" block, with its summary.
   * `"more"`: the "More commands" list. Left out: nowhere — a subcommand, or a command a hook
   * runs (`alert-worker`), which only `help <name>` and `--help` show.
   */
  listed?: "more" | "start";
  /**
   * What `help <name>` and `<name> --help` print. Left out on `help` itself, whose text is the
   * whole table: `helpTextFor` builds it then.
   */
  help?: string;
}

/** How wide a top-level help line may be: 80 columns, less a 4-column margin. */
const WIDTH = 76;

/**
 * The names `cc-smart-dev-kit hook` lists: the user-level notifier setup writes, from the one
 * constant that names it. The worktree engine's names are retired (a project now uses Claude
 * Code's own worktrees), so `notify` is the one left.
 */
export const HOOK_NAMES = USER_NOTIFY_HOOK_NAME;

/** The status line's warning share: the same default the status line itself reads. */
const WARNING_PERCENT = workflowDefaults.alerts.usagePercent;

export const HOOK_HELP = `Usage: ${COMMAND} hook <${HOOK_NAMES}>

notify is the notifier hook, with the same input and answer as the plugin's own bundle.
${COMMAND} setup wires it in your user settings for agent view, which runs no plugin hooks
(Claude Code's list of sessions raises agent_needs_input and agent_completed there). It is
not a project hook: it needs no settings from a project, and it works in every folder.`;

const SETUP_HELP = `Usage: ${COMMAND} setup [--dry-run] [--yes] [--project <dir>] [--warp | --remove-warp]
       [--no-instructions | --instructions] [--statusline] [${RETRY_WATCHDOG_FLAG} | ${NO_RETRY_WATCHDOG_FLAG}]
       [--tavily-key-stdin]

Installs the launcher in ~/.local/bin, turns Claude Code's own plugin auto-update off (the
kit's background update is the one updater, so a major version waits for you), installs the
plugin's instructions for Claude (a copy in ~/.claude/cc-smart-dev-kit/instructions/, imported
by a block in ~/.claude/CLAUDE.md), adds the companion plugins' marketplaces, points claude-mem
at the scout slot's affordable model (when its chain starts with one), and copies the
project's auto-mode entries into your settings. The entries are trust rules: they are shown
and asked on a terminal (--yes: shown, not asked); with no terminal they are left out, also
with --yes. --yes offers neither the status line nor the retry watchdog. It prints a section
per part, one verdict line, and the next steps to run, in order.

  --project <dir>      the project to read .claude/cc-smart-dev-kit.json from
                       (default: this folder)
  --warp               install the Warp terminal (the commands are shown and asked; sudo
                       asks for your password) and its Claude plugin
  --remove-warp        take them out again
  --tavily-key-stdin   the Tavily key on stdin (never an argument); setup writes it to the
                       key file it reads a key from, mode 600 (README § MCP servers)
  --no-instructions    take the instructions out and keep them out: a later plain setup
                       leaves them out too
  --instructions       bring them back (restore forgets the choice)
  --statusline         also set Claude Code's status line to "${COMMAND} statusline"
                       (asked when run in a terminal)
  ${RETRY_WATCHDOG_FLAG}     make every Claude Code session wait and retry at a limit instead
                       of failing, with no time limit (${RETRY_WATCHDOG_ENV} in your
                       settings; asked once when run in a terminal, default no)
  ${NO_RETRY_WATCHDOG_FLAG}  take it out again, and do not ask again
  --dry-run            print what would change, and write, run and check nothing`;

const DOCTOR_HELP = `Usage: ${COMMAND} doctor [--verbose] [--json] [--live]

Checks the install, the ${COMMAND} files the current project's CLAUDE.md imports, and
the project of the current folder, in groups. A group that passed shows one line; a failure
shows a Fix: line under it; the last line says what the run found. Exit code 1 when a check
fails.

  --verbose  show every line, the ones that passed too
  --json     print the whole report as JSON, for a program (the installers read it)
  --live     also run two throwaway Claude Code sessions in temp repos, to prove the hooks and
             the worktree engine on this Claude Code (uses your login; a few cents). Records
             the version it passed on.`;

const BROWSER_HELP = `Usage: ${COMMAND} browser <mcp|setup|token|check> [options]

  mcp      start the Playwright MCP server on YOUR OWN Chrome, through the Playwright
           extension, in the profile "claude-code". setup registers it as the "playwright"
           MCP server; you do not run it by hand.
  setup    find Chrome, make that profile and print the five steps that are left for you.
  token    save the extension's token, pasted from its status page: it is REQUIRED, because
           without it the extension would ask you to approve every connection.
  check    prove a real connection, a file:// page, screenshots, an upload and a download end
           to end (it opens that Chrome window once).`;

const BROWSER_SETUP_HELP = `Usage: ${COMMAND} browser setup [--dry-run]

Finds Chrome, makes the profile the extension runs in and prints the five steps that are left
for you. It never installs or removes an extension, and never deletes a profile. --dry-run
prints the same lines, and runs and writes nothing.`;

const MCP_HELP = `Usage: ${COMMAND} mcp status [--json]

The four MCP servers cc-smart-dev-kit registers for your user, and which of them are
registered by something else instead (a project's own script, say): one line each, --json for
a machine. Read-only. The installer uses it to ASK before it replaces one of yours. Exit 1
means Claude Code's own config could not be read, so "nothing is foreign" and "could not
check" are never confused.`;

const RESTORE_HELP = `Usage: ${COMMAND} restore [--yes] [--now]

Removes what cc-smart-dev-kit added, and keeps everything else: its settings keys and entries
(claude-mem's settings, the auto-mode entries), its Markdown blocks, and the files it created
(the launcher, the instructions, the router copy and units). Each changed file gets a backup
first. Plugins and marketplaces setup added stay installed.

With the gateway on, it runs in two stages: first everything but the router, which the running
sessions still use; after you restart them, again to stop and remove the router (it asks;
--yes: without asking). --now: both at once, and every running session fails until it
restarts.`;

const MIGRATE_HELP = `Usage: ${COMMAND} migrate [--dry-run] [--yes]

Moves a machine that still has this plugin's old "anymodel" names: its folders, its state
folder's records and backups, the settings keys the old setup owned (the slots' names and
words), the instructions block in ~/.claude/CLAUDE.md, the gateway config's slots (with an
alias for each old name, so running sessions keep working), and the router units.

On a 0.2.x machine this command does not exist yet: run the installed plugin's dist/cli.js
with bun --no-env-file --config=<its own bunfig.toml> (README, Moving from anymodel): without
the flags bun loads the working folder's .env files into the command and runs its bunfig.toml.

It reads and checks everything, then asks every question, and writes nothing before they are
answered: a "no" leaves the machine as it was. It then prints its steps and walks them; a step
that fails keeps what the steps before it did, and running it again goes on from there.
Refuses to run inside a Claude Code session: run it in your own terminal, then restart your
sessions.

  --dry-run    print the plan, and write, run and stop nothing
  --yes        no questions (the router is replaced without asking); the old plugin is
               uninstalled only after a terminal yes`;

const UPDATE_HELP = `${UPDATE_USAGE}

Installs a newer ${COMMAND} now, with the output of each step. --check: only say whether a
newer version exists. A new Claude session checks by itself, at most once an hour, and
installs it in the background; --hold stops that on this machine, --resume starts it again.
Nothing restarts: restart the sessions to load it.`;

const SESSIONS_HELP = `Usage: ${COMMAND} sessions [--open] [--dry-run]

This project's Claude Code sessions of the last two days, by name and worktree, with the
command that resumes each. --open reopens every session that was open when the machine went
down or its window closed (Warp tabs, or XFCE Terminal windows on Linux); --dry-run says what
it would open and opens nothing.`;

const WORKTREES_HELP = `Usage: ${COMMAND} worktrees [--clean] [--remove <path>] [--no-fetch]

Every worktree of this repo: who works in it, and which are finished (every commit on
origin/<base>, nothing uncommitted, no local files, no running session, no program or Docker
container using it).

  --clean              remove the finished ones, with their branches
  --remove <path>      remove one now, without the one-hour wait
  --no-fetch           judge against origin/<base> as it is, without fetching it first

--clean and --remove run in the main checkout only, one at a time.`;

const USAGE_HELP = `Usage: ${COMMAND} usage [--hours <n>] [--project <folder or name>] [--json]

Which models answered on this machine, per session: the main session's replies and its
subagents' apart (how each subagent was launched, the agents' types and models, their tokens,
the share on Opus and their estimated cost), from Claude Code's transcripts and each
subagent's own record (default: the last 6 hours). Read only; no message text.
--json prints the same facts as one object.`;

const SESSION_NAME_HELP = `Usage: ${COMMAND} session-name <session id> <name>

Names a Claude session after its task. The session-name hook runs it; a project turns that on
with "sessionNames" in its .claude/cc-smart-dev-kit.json.`;

const SUBAGENT_STATUSLINE_HELP = `Usage: ${COMMAND} subagent-statusline

One row body per subagent for Claude Code's agent panel: the slot, the model and the effort
(slot → model → effort). The plugin's own settings.json names it as Claude Code's
subagentStatusLine, so it runs by itself; its input comes on stdin, and it prints one JSON
line per row. Not a command to run by hand.`;

const STATUSLINE_HELP = `Usage: ${COMMAND} statusline

One line for Claude Code's status bar: plan usage (a warning from ${WARNING_PERCENT} %), and any
fallback the gateway is using. Reads the JSON Claude Code passes on stdin.`;

const VERSION_HELP = `Usage: ${COMMAND} version

Print the version.`;

const ALERT_WORKER_HELP = `Usage: ${COMMAND} ${ALERT_WORKER_COMMAND} <alert JSON>

Waits for a click on the desktop alert, then brings the alert's window back. The notify and
stop-failure hooks start it, detached, through the launcher. It is not a command to run by
hand.`;

/**
 * Every command, in the order the top-level help shows them. A command the dispatcher knows and
 * this table does not would have no help: `src/cli/help.test.ts` fails when one is added
 * without a row.
 */
export const COMMAND_HELP: readonly CommandHelp[] = [
  {
    name: "setup",
    summary: "Set up this machine (safe to run again)",
    listed: "start",
    help: SETUP_HELP,
  },
  {
    name: "doctor",
    summary: "Check that everything works, and say what to fix",
    listed: "start",
    help: DOCTOR_HELP,
  },
  {
    name: "browser setup",
    summary: "Let Claude use your own Chrome",
    listed: "start",
    help: BROWSER_SETUP_HELP,
  },
  {
    name: "gateway setup",
    summary: "Optional: more affordable models, through a local gateway",
    listed: "start",
    help: GATEWAY_USAGE,
  },
  {
    name: "project init",
    summary: "Turn the plugin's features on in this project",
    listed: "start",
    help: PROJECT_INIT_USAGE,
  },
  { name: "workflow", listed: "more", help: WORKFLOW_USAGE },
  // The lead's hand-back gate (D22): `help workflow merge-check` prints the workflow's own
  // usage, which carries merge-check's lines — one text, not a second copy.
  { name: "workflow merge-check", help: WORKFLOW_USAGE },
  { name: "update", listed: "more", help: UPDATE_HELP },
  { name: "restore", listed: "more", help: RESTORE_HELP },
  { name: "migrate", listed: "more", help: MIGRATE_HELP },
  { name: "sessions", listed: "more", help: SESSIONS_HELP },
  { name: "worktrees", listed: "more", help: WORKTREES_HELP },
  { name: "usage", listed: "more", help: USAGE_HELP },
  { name: "report", listed: "more", help: REPORT_USAGE },
  { name: "portal", listed: "more", help: PORTAL_USAGE },
  { name: "mcp", listed: "more", help: MCP_HELP },
  { name: "omniroute", listed: "more", help: OMNIROUTE_USAGE },
  { name: "job", listed: "more", help: JOB_USAGE },
  { name: "crew", listed: "more", help: CREW_USAGE },
  { name: "hook", listed: "more", help: HOOK_HELP },
  { name: "statusline", listed: "more", help: STATUSLINE_HELP },
  { name: "version", listed: "more", help: VERSION_HELP },
  // Not in the top-level help: a group whose subcommands it names instead, and the commands a
  // hook runs. `gateway setup` and `project init` are the rows the top-level help shows.
  { name: "browser", help: BROWSER_HELP },
  { name: "gateway", help: GATEWAY_USAGE },
  { name: "project", help: PROJECT_INIT_USAGE },
  { name: "mcp status", help: MCP_HELP },
  // The board and the end of a crew session: a row each, from their own table (`crew/usage.ts`).
  ...BOARD_COMMANDS.map((one) => ({ name: `crew ${one.name}`, help: one.help })),
  // A crew session's note to another: its help sits beside the board's, so both read one text.
  { name: "crew tell", help: TELL_USAGE },
  { name: "session-name", help: SESSION_NAME_HELP },
  // Claude Code runs it from the plugin's settings.json: a status line's row body, not a
  // command for a person.
  { name: "subagent-statusline", help: SUBAGENT_STATUSLINE_HELP },
  { name: ALERT_WORKER_COMMAND, help: ALERT_WORKER_HELP },
  // `help` prints the top-level help, which is built from this table (see `helpTextFor`).
  { name: HELP_COMMAND },
];

/** The row for a command path: the longest name whose words start it. */
function rowFor(words: readonly string[]): CommandHelp | null {
  let best: CommandHelp | null = null;
  for (const row of COMMAND_HELP) {
    const name = row.name.split(" ");
    if (name.length > words.length) continue;
    if (!name.every((word, index) => word === words[index])) continue;
    if (best === null || name.length > best.name.split(" ").length) best = row;
  }
  return best;
}

/** The words before the first option: the command a help request names. */
export function commandWords(argv: readonly string[]): string[] {
  const words: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("-")) break;
    words.push(arg);
  }
  return words;
}

/**
 * Whether `argv` asks for help: `-h` or `--help` anywhere before a `--`. After a `--` they
 * belong to the command (`job run -- bun test --help` is the test's own flag).
 */
export function asksForHelp(argv: readonly string[]): boolean {
  for (const arg of argv) {
    if (arg === "--") return false;
    if (arg === "-h" || arg === "--help") return true;
  }
  return false;
}

/**
 * The help `words` name: the longest row whose words start them, the top-level help when they
 * name nothing (`help` alone, `cc-smart-dev-kit --help`), and null when they name a command the
 * table does not know (the caller reports that command).
 */
export function helpTextFor(words: readonly string[]): string | null {
  const named = words[0] === HELP_COMMAND ? words.slice(1) : words;
  if (named.length === 0) return topLevelHelp();
  const row = rowFor(named);
  if (row === null) return null;
  // The `help` row has no text of its own: what it prints is the table itself.
  return row.help ?? topLevelHelp();
}

/** One line of a usage mistake, and the one command that explains it (`UX-3`). */
export function usageError(line: string, command: null | string): string {
  return `${line}\nSee: ${COMMAND} ${command === null ? "" : `${command} `}--help`;
}

/** The answer an unknown command gets: one line, then the help that lists the commands. */
export function unknownCommand(name: string): string {
  return usageError(`Unknown command: ${name}`, null);
}

/** A list of words wrapped onto lines of at most `WIDTH`, the ones after the first indented. */
function wrapList(prefix: string, text: string): string[] {
  const lines: string[] = [];
  let line = prefix;
  for (const word of text.split(" ")) {
    const candidate = line === prefix ? `${line}${word}` : `${line} ${word}`;
    if (candidate.length > WIDTH && line !== prefix) {
      lines.push(line);
      line = `  ${word}`;
    } else {
      line = candidate;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * The top-level help: the header, the "Start here" rows with their summaries, two examples, and
 * the names of every other command. Built from the table, so a new command needs no second
 * place here.
 */
export function topLevelHelp(): string {
  const start = COMMAND_HELP.filter((row) => row.listed === "start");
  const width = Math.max(...start.map((row) => row.name.length)) + 4;
  const more = COMMAND_HELP.filter((row) => row.listed === "more").map((row) => row.name);
  return [
    `${COMMAND} ${VERSION}: sets up and checks this machine for Claude Code`,
    "",
    `Usage: ${COMMAND} <command> [options]`,
    "",
    "Start here",
    ...start.map((row) => `  ${row.name.padEnd(width)}${row.summary ?? ""}`),
    "",
    "Examples",
    `  ${COMMAND} setup --dry-run     show what setup would change`,
    `  ${COMMAND} doctor              the health check`,
    "",
    ...wrapList("More commands: ", more.join(", ")),
    `Help on one:  ${COMMAND} ${HELP_COMMAND} <command>   (or <command> --help)`,
  ].join("\n");
}
