/**
 * The help table's own tests: the shape of the top-level help, and the rule that a command the
 * dispatcher answers has a row here. What a person sees through the real CLI — `--help` on every
 * command, the errors, `worktrees --help` not scanning — is `cli.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND, VERSION } from "../build-info";
import { CREW_USAGE } from "../crew/command";
import { BOARD_COMMANDS, TELL_USAGE } from "../crew/usage";
import { USAGE as GATEWAY_USAGE } from "../gateway/commands";
import { ALERT_WORKER_COMMAND } from "../hooks/stop-failure";
import { USAGE as JOB_USAGE } from "../jobs/commands";
import { USAGE as OMNIROUTE_USAGE } from "../omniroute/commands";
import { PORTAL_USAGE } from "../portal/command";
import { USER_NOTIFY_HOOK_NAME } from "../setup/user-notify-hook";
import { WORKFLOW_USAGE } from "../workflow/commands";
import { workflowDefaults } from "../workflow/schema";
import {
  asksForHelp,
  COMMAND_HELP,
  commandWords,
  HELP_COMMAND,
  helpTextFor,
  topLevelHelp,
  unknownCommand,
  usageError,
} from "./help";
import { PROJECT_INIT_USAGE } from "./project-init";
import { UPDATE_USAGE } from "./update";

/** The dispatcher's source: the one list of the commands it answers. */
const CLI_SOURCE = readFileSync(join(import.meta.dir, "..", "entries", "cli.ts"), "utf8");

/**
 * Every `case` of the dispatcher's `switch (command)`, as written. `case "x": {` and
 * `case "x":` both count; so does a constant (`case ALERT_WORKER_COMMAND:`).
 */
function dispatcherCases(): string[] {
  const start = CLI_SOURCE.indexOf("switch (command) {");
  if (start === -1) throw new Error("no `switch (command)` in src/entries/cli.ts");
  return [...CLI_SOURCE.slice(start).matchAll(/^ {4}case (.+):\s*\{?$/gm)].map(
    (match) => match[1] ?? "",
  );
}

describe("the command table", () => {
  test("CM-12: every command the dispatcher answers has a help row", () => {
    // The names that are not a command of their own: no command at all, and the flags the
    // argument step answers before the dispatch (they print the top-level help).
    const notCommands = new Set(["undefined", '"--version"', '"--help"', '"-h"']);
    const names = dispatcherCases()
      .filter((one) => !notCommands.has(one))
      .map((one) => (one === "ALERT_WORKER_COMMAND" ? ALERT_WORKER_COMMAND : one.slice(1, -1)));
    // The dispatcher really has the commands this test says it has, so an empty read fails too.
    expect(names).toContain("setup");
    expect(names).toContain("worktrees");
    expect(names.length).toBeGreaterThan(15);
    for (const name of names) {
      expect(COMMAND_HELP.some((row) => row.name === name)).toBe(true);
    }
  });

  test("CM-12: a command whose module writes its own usage text imports it, never a copy", () => {
    expect(helpTextFor(["gateway"])).toBe(GATEWAY_USAGE);
    expect(helpTextFor(["gateway", "setup"])).toBe(GATEWAY_USAGE);
    expect(helpTextFor(["omniroute"])).toBe(OMNIROUTE_USAGE);
    expect(helpTextFor(["job"])).toBe(JOB_USAGE);
    expect(helpTextFor(["workflow"])).toBe(WORKFLOW_USAGE);
    expect(helpTextFor(["portal"])).toBe(PORTAL_USAGE);
    expect(helpTextFor(["project", "init"])).toBe(PROJECT_INIT_USAGE);
    expect(helpTextFor(["update"])).toStartWith(UPDATE_USAGE);
  });

  test("CM-12: `crew --help` lists every crew session command with a short line, the board's own rows from their table", () => {
    const usage = helpTextFor(["crew"]) ?? "";
    // The names of the plan's phases: the launcher, the watch and the reports, the board.
    for (const name of [
      "lead",
      "start",
      "watch",
      "self-watch",
      "step",
      "report",
      "answer",
      "list",
      "status",
      "stop",
      "rm",
      "resume",
      "attach",
      "kinds",
    ]) {
      expect(usage).toMatch(new RegExp(`^  ${name}\\b`, "m"));
    }
    // A row each for the board and the end of a crew session, with its own help and nothing else.
    for (const one of BOARD_COMMANDS) {
      expect(helpTextFor(["crew", one.name])).toBe(one.help);
      expect(one.help).toStartWith(`Usage: ${COMMAND} crew ${one.name}`);
      expect(usage).toContain(one.summary);
    }
    expect(BOARD_COMMANDS.map((one) => one.name)).toEqual([
      "list",
      "status",
      "stop",
      "rm",
      "resume",
      "attach",
      "kinds",
    ]);
    // The commands that are not in the table still print the whole usage.
    expect(helpTextFor(["crew", "start"])).toBe(CREW_USAGE);
    expect(helpTextFor(["crew", "lead"])).toBe(CREW_USAGE);
    // `crew tell` has its own text, a crew session's one note to another (D47).
    expect(helpTextFor(["crew", "tell"])).toBe(TELL_USAGE);
    expect(usage).toContain("  tell <name…> --kind contract|question");
  });

  test("CM-12: the hook help names the one hook left, from the constant that names it", () => {
    // The worktree engine's names are retired, so `notify` is the one name: never typed here,
    // read from the constant the notifier's own wiring uses.
    expect(USER_NOTIFY_HOOK_NAME).toBe("notify");
    expect(helpTextFor(["hook"])?.split("\n")[0]).toBe(
      `Usage: ${COMMAND} hook <${USER_NOTIFY_HOOK_NAME}>`,
    );
  });

  test("CM-12: the status line's help names the workflow's warning share, not a typed 85", () => {
    expect(helpTextFor(["statusline"])).toContain(
      `a warning from ${workflowDefaults.alerts.usagePercent} %`,
    );
  });
});

describe("the top-level help", () => {
  test("UX-3: it is one screen, and every line fits 80 columns", () => {
    const expected = [
      `${COMMAND} ${VERSION}: sets up and checks this machine for Claude Code`,
      "",
      `Usage: ${COMMAND} <command> [options]`,
      "",
      "Start here",
      "  setup            Set up this machine (safe to run again)",
      "  doctor           Check that everything works, and say what to fix",
      "  browser setup    Let Claude use your own Chrome",
      "  gateway setup    Optional: set up the local AI gateway",
      "  project init     Turn the plugin's features on in this project",
      "",
      "Examples",
      `  ${COMMAND} setup --dry-run     show what setup would change`,
      `  ${COMMAND} doctor              the health check`,
      "",
      "More commands: workflow, update, restore, migrate, launch, sessions,",
      "  worktrees, usage, report, portal, mcp, omniroute, job, crew, hook,",
      "  statusline, version",
      `Help on one:  ${COMMAND} ${HELP_COMMAND} <command>   (or <command> --help)`,
    ].join("\n");
    expect(topLevelHelp()).toBe(expected);
    // 80 columns, counted the way a terminal counts them (`Bun.stringWidth`), not by bytes.
    for (const line of topLevelHelp().split("\n")) {
      expect(Bun.stringWidth(line)).toBeLessThanOrEqual(80);
    }
  });

  test("every row can be asked for by name, and a start row always carries its summary", () => {
    for (const row of COMMAND_HELP) {
      const text = helpTextFor(row.name.split(" "));
      expect(`${row.name}: ${text === null ? "no help" : ""}`).toBe(`${row.name}: `);
      expect(text === null ? 0 : Bun.stringWidth(text)).toBeGreaterThan(0);
      // The "Start here" block prints the summary next to the name: a start row without one
      // would print a bare name.
      if (row.listed === "start") expect(row.summary ?? "").not.toBe("");
      // A row with no summary is never in the start block: the block is summaries.
      if (row.summary === undefined) expect(row.listed ?? "none").not.toBe("start");
    }
  });
});

describe("a help request", () => {
  test("UX-2: `-h` or `--help` anywhere before a `--` asks for help", () => {
    expect(asksForHelp(["--help"])).toBe(true);
    expect(asksForHelp(["-h"])).toBe(true);
    expect(asksForHelp(["gateway", "setup", "--help"])).toBe(true);
    expect(asksForHelp(["worktrees", "--clena", "-h"])).toBe(true);
    expect(asksForHelp(["setup"])).toBe(false);
    // After a `--`, `--help` belongs to the command that runs (`job run -- bun test --help`).
    expect(asksForHelp(["job", "run", "--", "bun", "test", "--help"])).toBe(false);
  });

  test("UX-2: the words before the first option name the command", () => {
    expect(commandWords(["gateway", "setup", "--help"])).toEqual(["gateway", "setup"]);
    expect(commandWords(["setup", "--project", "/tmp/x", "--help"])).toEqual(["setup"]);
    expect(commandWords(["--help", "setup"])).toEqual([]);
    expect(commandWords(["job", "run", "--", "bun", "test", "--help"])).toEqual(["job", "run"]);
  });

  test("UX-2: the longest row that starts the words answers, and only a known one does", () => {
    expect(helpTextFor([])).toBe(topLevelHelp());
    expect(helpTextFor([HELP_COMMAND])).toBe(topLevelHelp());
    expect(helpTextFor([HELP_COMMAND, "gateway", "setup"])).toBe(GATEWAY_USAGE);
    expect(helpTextFor(["browser", "setup"])).toStartWith(`Usage: ${COMMAND} browser setup`);
    expect(helpTextFor(["gateway", "setup"])).toBe(GATEWAY_USAGE);
    expect(helpTextFor(["gateway", "models"])).toBe(GATEWAY_USAGE);
    // The rest of the line never changes which help prints.
    expect(helpTextFor(["worktrees", "extra"])).toBe(helpTextFor(["worktrees"]));
    expect(helpTextFor(["nope"])).toBeNull();
  });

  test("UX-3: a usage mistake is one line and the help that explains it", () => {
    expect(usageError("Unknown option: --x", "doctor")).toBe(
      `Unknown option: --x\nSee: ${COMMAND} doctor --help`,
    );
    expect(unknownCommand("nope")).toBe(`Unknown command: nope\nSee: ${COMMAND} --help`);
  });
});
