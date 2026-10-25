import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative } from "node:path";
import { browserSetupReport, realBrowserSetupDeps } from "../browser/setup";
import {
  COMMAND,
  MARKETPLACE,
  MARKETPLACE_ADD_COMMAND,
  PLUGIN_INSTALL_COMMAND,
  VERSION,
} from "../build-info";
import { messageOf } from "../gateway/config";
import {
  applyClaudeMem,
  type ClaudeMemPlan,
  checkAffordableTarget,
  claudeMemPlan,
  shownClaudeMemValue,
  TODO_TOOLS_KEY,
  TODO_TOOLS_VALUE,
  WORK_STATE_KEY,
} from "../machine/claude-mem";
import { type CompanionStep, companionPlan, runCompanionSteps } from "../machine/companions";
import type { Machine } from "../machine/machine";
import {
  clearWarpStage,
  detectSystem,
  detectWarpApp,
  removeWarpDesktopEntries,
  showCommand,
  stageWarpFiles,
  warpDesktopEntries,
  warpInstallCommands,
  warpPluginRemoveSteps,
  warpPluginSteps,
  warpRemoveCommands,
} from "../machine/warp";
import {
  type McpRecord,
  markMcpServerAdding,
  mcpRecordsFile,
  readMcpRecords,
} from "../mcp/records";
import {
  applyMcpServers,
  type ClaudeRun,
  planMcpServers,
  readUserServers,
  recordApplied,
  unreadableRecordsNote,
  unreadableUserConfigNote,
} from "../mcp/register";
import { applySerenaCleanup, planRetiredServers, planSerenaCleanup } from "../mcp/retired";
import { mcpServers } from "../mcp/servers";
import { readTavilyKey, TAVILY_KEY_PATH } from "../mcp/tavily";
import {
  AUTO_MODE_PATH,
  type AutoModeSource,
  applyAutoMode,
  autoModeSource,
} from "../setup/auto-mode";
import { AUTO_UPDATE_KEY, AUTO_UPDATE_VALUE } from "../setup/auto-update";
import {
  type InstructionsPaths,
  installInstructions,
  instructionsOptedOut,
  instructionsPaths,
  removeInstructions,
  setInstructionsOptOut,
} from "../setup/instructions";
import { installLauncher } from "../setup/launcher";
import { installLauncherCmd, launcherArgv } from "../setup/launcher-cmd";
import { withLock } from "../setup/lock";
import {
  applyManagedJson,
  createdObjects,
  formatKeyPath,
  getKey,
  isObject,
  type KeyPath,
  ownedKeys,
  ownedRecords,
  ownership,
  readJsonObject,
  samePath,
} from "../setup/managed-json";
import {
  planRemoteControl,
  REMOTE_CONTROL_KEY,
  REMOTE_CONTROL_VALUE,
} from "../setup/remote-control";
import {
  RETRY_WATCHDOG_DECLINED_NOTE,
  RETRY_WATCHDOG_KEY,
  RETRY_WATCHDOG_ON_NOTE,
  RETRY_WATCHDOG_SETTINGS,
  retryWatchdogDeclined,
  retryWatchdogDeclinedFile,
  retryWatchdogKeysOurs,
  retryWatchdogState,
} from "../setup/retry-watchdog";
import { STATUSLINE_KEY, statuslineSetting } from "../setup/statusline";
import { applyTmuxLine, TMUX_LINE, TMUX_NOW_COMMAND, tmuxServerRunning } from "../setup/tmux";
import { readUserJson } from "../setup/user-json";
import { applyUserNotifyHook, USER_NOTIFY_COMMAND } from "../setup/user-notify-hook";
import { atomicWrite, realTarget } from "../setup/write";
import { retiredRepoLines } from "../update/retired-repos";
import { groupTitle } from "./check";
import { type CliPaths, tildify } from "./paths";
import {
  createOut,
  dryRunEnding,
  leadingMark,
  type Mark,
  type NextStep,
  type Out,
  plural,
} from "./ui/out";
import { currentTerminal } from "./ui/terminal";

export interface SetupOptions {
  /** Show every change; write and run nothing (and reach no network). */
  dryRun: boolean;
  /**
   * Write a project's auto-mode entries without asking. Only on a terminal: with no
   * terminal they are left out whatever the flags. They are still shown.
   */
  yes: boolean;
  /** Install the Warp app (asked first, on a terminal), then its Claude plugin. */
  warp: boolean;
  /** Remove the Warp app, its package source and key, its shortcuts, and its plugin. */
  removeWarp: boolean;
  /** The folder whose project's `.claude/cc-smart-dev-kit.json` gives the auto-mode entries. */
  project: string;
  machine: Machine;
  /**
   * `false`: `--no-instructions` — take them out, and remember it. `true`: `--instructions` —
   * forget that choice and install them. `null`: neither — follow the stored choice (on, unless
   * an earlier `--no-instructions` is stored).
   */
  instructions: boolean | null;
  /** The plugin's `instructions` folder, beside `dist/`. */
  instructionsSource: string;
  /** `--statusline`: set the status line without asking. */
  statusline: boolean;
  /**
   * Claude Code's retry watchdog for the person's own sessions (`src/setup/retry-watchdog.ts`).
   * `true`: `--retry-watchdog` — write its three keys, and forget an earlier "no". `false`:
   * `--no-retry-watchdog` — take ours out, and remember a "no". `null`: neither — on by
   * default (D56), unless a "no" is on file or the person set a key of their own.
   */
  retryWatchdog: boolean | null;
  /** The environment: the Tavily key may come from it (`TAVILY_API_KEY`). */
  env: Record<string, string | undefined>;
  /**
   * `--tavily-key-stdin`: the Tavily key, which arrived on stdin. setup writes it to the key
   * file a person may write by hand (mode 0600, the plugin's own atomic writer) and then
   * treats it as a key from that file, so a later setup keeps it. Never an argument: a
   * command line is readable in `/proc` and lands in the shell's history.
   */
  tavilyKeyStdin: null | string;
  /** Where the report prints: this process's terminal when left out (a test passes its own). */
  out?: Out;
}

function show(value: unknown): string {
  return value === undefined ? "(none)" : JSON.stringify(value);
}

/**
 * A value as setup prints it: the Tavily key is never shown, only that it is one (and
 * `(none)` when it is gone).
 */
function shownValue(path: KeyPath, value: unknown): string {
  if (formatKeyPath(path) !== formatKeyPath(TAVILY_KEY_PATH)) return show(value);
  return value === undefined ? "(none)" : "(a secret)";
}

/** True when settings.json knows the cc-smart-dev-kit marketplace (written by `claude plugin install`). */
function marketplaceKnown(settingsFile: string): boolean {
  if (!existsSync(settingsFile)) return false;
  try {
    const settings = readUserJson(settingsFile);
    const known = isObject(settings) ? settings.extraKnownMarketplaces : undefined;
    return isObject(known) && isObject(known[MARKETPLACE]);
  } catch {
    // Not JSON: the marketplace cannot be read out of it; the message names the file.
    return false;
  }
}

/** Says the person answered "no" to the status line: setup does not ask again. */
export function statuslineDeclinedFile(stateDir: string): string {
  return join(stateDir, "statusline-declined");
}

/** True when settings.json has a `statusLine` of any kind. */
function hasStatusline(settingsFile: string): boolean {
  if (!existsSync(settingsFile)) return false;
  try {
    const settings = readUserJson(settingsFile);
    return isObject(settings) && Object.hasOwn(settings, "statusLine");
  } catch {
    // An unreadable file: setup's own pass reports it.
    return false;
  }
}

/** What the managed writes cover, decided before the read-only pass. */
interface Managed {
  claudeMem: ClaudeMemPlan | null;
  autoMode: AutoModeSource | null;
  /** The instructions: where they go, and `SetupOptions.instructions`. */
  instructions: { where: InstructionsPaths; choice: boolean | null };
  /** Set the status line (`--statusline`, or a "yes" to the question). */
  statusline: boolean;
  /**
   * The retry watchdog's keys: `on` (`--retry-watchdog`, or the D56 default) writes them and
   * forgets an earlier "no", `off` (`--no-retry-watchdog`) takes ours out and remembers the
   * "no", `null` leaves everything as it is (a "no" on file, or a key of the person's own).
   */
  retryWatchdog: "off" | "on" | null;
  /**
   * What the settings' own `env.TAVILY_API_KEY` gets — the ONE decision, from where the key
   * was found (`readTavilyKey`):
   *   - `write`: a key file (or `--tavily-key-stdin`) has it: setup owns the settings copy.
   *   - `keep`: the settings already hold it (the person set it there, or setup wrote it on an
   *     earlier run): nothing to write, and nothing to remove — it is the key Claude Code
   *     expands `Bearer ${TAVILY_API_KEY}` from.
   *   - `remove`: no key anywhere but a copy setup wrote earlier: take that copy out.
   */
  tavilyKeyPlan: { kind: "keep" } | { kind: "remove" } | { kind: "write"; value: string };
  /** The Tavily key that arrived on stdin, to write to the key file first, or null. */
  tavilyKeyFile: null | string;
  /** Add tmux's passthrough line (`tmux` is installed, so the person uses tmux). */
  tmuxLine: boolean;
}

/**
 * The sections of setup's report, in the order it prints them, each with the title a person
 * reads. A section with nothing to say is left out. Three titles are doctor's own groups
 * (`CHECK_GROUPS`): the same words for the same part, wherever it is printed.
 */
export const SETUP_SECTIONS = [
  { id: "command", title: "The command" },
  { id: "settings", title: "Claude Code settings" },
  { id: "instructions", title: "Instructions" },
  { id: "companions", title: groupTitle("companions") },
  { id: "mcp", title: groupTitle("mcp") },
  { id: "browser", title: groupTitle("browser") },
  { id: "projects", title: "Projects" },
  { id: "terminal", title: "Terminal" },
] as const;

export type SetupSection = (typeof SETUP_SECTIONS)[number]["id"];

/** One line of setup's report: its section, its mark, its words, and what it names under it. */
interface ReportLine {
  section: SetupSection;
  mark: Mark;
  text: string;
  /** The step a person takes, printed under the text (`Fix: …`). */
  fix?: string;
  /** Commands under the text, printed whole (`$ claude plugin install …`). */
  detail?: readonly string[];
}

/** What setup prints, line by line; each line's section and mark decide where it goes. */
type Report = ReportLine[];

/** A line that changes something, or a command run or to run: what "a change" counts. */
const CHANGE_MARKS: ReadonlySet<Mark> = new Set<Mark>(["changed", "created", "removed", "run"]);

/**
 * A line made by a part setup shares with `restore`, `doctor` or `browser setup` (the MCP
 * registrations, the companions, Serena's clean-up, the browser, claude-mem's plan), which
 * writes its mark in front: `+ ` `~ ` `- ` `! ` `$ `, or two spaces for information. Read here,
 * once, into a report line.
 */
function reportLine(section: SetupSection, text: string): ReportLine {
  const found = leadingMark(text);
  if (found !== null) return { section, mark: found.mark, text: found.text };
  return { section, mark: "info", text: text.trimStart() };
}

/** Each of `texts`, as `reportLine` reads it. */
function reportLines(section: SetupSection, texts: readonly string[]): ReportLine[] {
  return texts.map((text) => reportLine(section, text));
}

/** What `applySetup` did (or, in a dry run, would do). */
interface Applied {
  lines: Report;
  /** The tmux line was (or would be) added in this run. */
  tmuxAdded: boolean;
  /** claude-mem's settings changed: its start hook and its worker read them when they start. */
  claudeMemChanged: boolean;
}

/**
 * Every change setup makes to files, in order. With `dryRun`, it only reports them.
 * `takenBack`: the retired MCP registrations this run takes out (a dry run: the ones it
 * would), which no longer keep Serena's old context file in place (`retired.ts`).
 */
function applySetup(
  paths: CliPaths,
  managed: Managed,
  dryRun: boolean,
  takenBack: readonly string[],
  platform: NodeJS.Platform,
): Applied {
  const short = (path: string) => tildify(path, paths.home);
  const lines: Report = [];
  const add = (section: SetupSection, mark: Mark, text: string) => {
    lines.push({ section, mark, text });
  };
  const launcher = installLauncher(paths.binDir, {
    stateDir: paths.stateDir,
    bunPath: process.execPath,
    dryRun,
  });
  if (launcher.outcome !== "unchanged") {
    const mark = launcher.outcome === "created" ? "created" : "changed";
    add("command", mark, `${short(launcher.path)}: launcher ${launcher.outcome}`);
  }
  // Windows gets the `.cmd` twin beside the sh launcher: cmd and PowerShell cannot run the
  // sh one, and Git Bash can — both do the same thing. `restore` removes whichever is there.
  if (platform === "win32") {
    const cmd = installLauncherCmd(paths.binDir, {
      stateDir: paths.stateDir,
      bunPath: process.execPath,
      dryRun,
    });
    if (cmd.outcome !== "unchanged") {
      const mark = cmd.outcome === "created" ? "created" : "changed";
      add("command", mark, `${short(cmd.path)}: launcher ${cmd.outcome}`);
    }
  }

  // The Tavily key that came on stdin goes to the key file a person may write by hand: the
  // one home of that key, mode 0600, written atomically. From then on setup reads the key
  // from there, so a later run keeps it, and `restore` leaves the file (it is the person's
  // key, not a settings key setup owns).
  if (managed.tavilyKeyFile !== null) {
    const mark = existsSync(paths.tavilyKeyFile) ? "changed" : "created";
    if (!dryRun) {
      mkdirSync(dirname(paths.tavilyKeyFile), { mode: 0o700, recursive: true });
      atomicWrite(paths.tavilyKeyFile, `${managed.tavilyKeyFile}\n`, 0o600);
    }
    add("mcp", mark, `${short(paths.tavilyKeyFile)}: the Tavily key (a secret, mode 600)`);
  }

  // Claude Code's own plugin auto-update off, so a major version waits for the person (D39):
  // why it is `false` and not a removed key, in `src/setup/auto-update.ts`.
  const set: (readonly [KeyPath, unknown])[] = [[AUTO_UPDATE_KEY, AUTO_UPDATE_VALUE]];
  // Remote Control connects at a session's start (D66): a default, written only while the
  // key is absent. A value of the person's stays, unnamed (`src/setup/remote-control.ts`).
  if (planRemoteControl(paths)) set.push([REMOTE_CONTROL_KEY, REMOTE_CONTROL_VALUE]);
  if (managed.statusline) set.push([STATUSLINE_KEY, statuslineSetting(paths)]);
  if (managed.retryWatchdog === "on") set.push(...RETRY_WATCHDOG_SETTINGS);
  if (managed.tavilyKeyPlan.kind === "write") {
    set.push([TAVILY_KEY_PATH, managed.tavilyKeyPlan.value]);
  }
  // claude-mem's work state goes off (D23): Claude Code's own task tools are a session's
  // to-do home then. A value the person set themselves stays, and is named below.
  const todoTools = managed.claudeMem?.todoTools === true ? planTodoTools(paths) : null;
  if (todoTools?.kind === "set") set.push([todoTools.path, TODO_TOOLS_VALUE]);
  // The key's source moved: the environment has it now (or there is no key at all), so the
  // key cc-smart-dev-kit wrote into the settings goes — the person's environment must not be
  // shadowed by a stale copy. Only while the key still holds what cc-smart-dev-kit wrote:
  // one the person changed is theirs (`applyManagedJson`). A key the settings themselves
  // hold (`keep`) is left exactly as it is.
  const tavilyOwned =
    managed.tavilyKeyPlan.kind === "remove" &&
    ownedKeys(paths.stateDir, realTarget(paths.settingsFile)).some(
      (path) => formatKeyPath(path) === formatKeyPath(TAVILY_KEY_PATH),
    );
  // `--no-retry-watchdog`: only the keys that are ours, so a person's own is not even named.
  const watchdogOwned =
    managed.retryWatchdog === "off"
      ? RETRY_WATCHDOG_SETTINGS.map(([path]) => path).filter((path) =>
          ownedKeys(paths.stateDir, realTarget(paths.settingsFile)).some(
            (owned) => formatKeyPath(owned) === formatKeyPath(path),
          ),
        )
      : [];
  const settings = applyManagedJson({
    file: paths.settingsFile,
    stateDir: paths.stateDir,
    // The Tavily key is a secret: errors say "a secret", owned.json keeps only its SHA-256,
    // and the settings file is left at mode 600.
    secret: (path) => formatKeyPath(path) === formatKeyPath(TAVILY_KEY_PATH),
    set,
    remove: [...(tavilyOwned ? [TAVILY_KEY_PATH] : []), ...watchdogOwned],
    // An `env` setup created goes with its last key; one the person had stays.
    createdObject: createdObjects(paths.stateDir, paths.settingsFile),
    dryRun,
  });
  // The Tavily key is its MCP server's: its line goes with the servers.
  const keySection = (path: KeyPath): SetupSection =>
    formatKeyPath(path) === formatKeyPath(TAVILY_KEY_PATH) ? "mcp" : "settings";
  for (const change of settings.changes) {
    add(
      keySection(change.path),
      "changed",
      `${short(settings.file)}: ${formatKeyPath(change.path)}: ${shownValue(change.path, change.before)} -> ${shownValue(change.path, change.after)}`,
    );
  }
  for (const skip of settings.skipped) {
    add(
      keySection(skip.path),
      "info",
      `${short(settings.file)}: ${formatKeyPath(skip.path)}: ${skip.reason}`,
    );
  }
  // D56: the watchdog is on by default. When this run turns it on, one `·` line says what
  // every session on the machine now does, and how to turn it off. A run that only adds the
  // cap to the two keys an older setup wrote is that one change line, with no note. A "no"
  // on file gets its own line instead, and only while the watchdog is really off: an older
  // `--retry-watchdog` could leave a "no" beside our own keys, and a key of the person's own
  // decides without that line.
  const watchdogTurnedOn = settings.changes.some(
    (change) => formatKeyPath(change.path) === formatKeyPath(RETRY_WATCHDOG_KEY),
  );
  if (managed.retryWatchdog === "on" && watchdogTurnedOn) {
    add("settings", "info", RETRY_WATCHDOG_ON_NOTE);
  }
  if (
    managed.retryWatchdog === null &&
    retryWatchdogDeclined(paths.stateDir) &&
    retryWatchdogState(paths) === "off"
  ) {
    add("settings", "info", RETRY_WATCHDOG_DECLINED_NOTE);
  }
  if (todoTools?.kind === "kept") {
    add(
      "settings",
      "info",
      `${short(settings.file)}: ${formatKeyPath(todoTools.path)} is ${JSON.stringify(todoTools.value)} (your choice); left alone`,
    );
  }

  if (managed.autoMode !== null) {
    const result = applyAutoMode(paths.settingsFile, paths.stateDir, managed.autoMode, dryRun);
    const where = `${short(result.file)}: ${formatKeyPath(AUTO_MODE_PATH)}`;
    for (const entry of result.added) {
      add("projects", "changed", `${where}: added ${JSON.stringify(entry)}`);
    }
    for (const entry of result.removed) {
      add("projects", "changed", `${where}: removed ${JSON.stringify(entry)}`);
    }
    for (const entry of result.skipped) {
      add(
        "projects",
        "info",
        `${where}: ${JSON.stringify(entry)} is there already (not cc-smart-dev-kit's); left alone`,
      );
    }
  }

  // Agent view (Claude Code's list of sessions) runs only the hooks in settings files, never
  // a plugin's hooks.json, so its two notification types need this one user-level entry. The
  // command runs the launcher, which survives a plugin update (`user-notify-hook.ts`).
  const notifyHook = applyUserNotifyHook(paths, dryRun);
  const notifyWhere = `${short(paths.settingsFile)}: ${formatKeyPath(["hooks", "Notification"])}`;
  if (notifyHook.action === "left") {
    // The person edited the managed entry: it is theirs now, and setup adds no second one.
    add(
      "settings",
      "info",
      `${notifyWhere}: a hook with this matcher was edited since setup wrote it (${USER_NOTIFY_COMMAND}); it stays, and no second one was added`,
    );
  } else if (notifyHook.action !== "unchanged") {
    add(
      "settings",
      "changed",
      notifyHook.action === "replaced"
        ? `${notifyWhere}: replaced the hand-written notify hook with the managed one (${USER_NOTIFY_COMMAND})`
        : `${notifyWhere}: ${notifyHook.action === "updated" ? "updated" : "added"} the agent-view notification hook (${USER_NOTIFY_COMMAND})`,
    );
  }

  let claudeMemChanged = false;
  if (managed.claudeMem !== null) {
    const result = applyClaudeMem(paths, managed.claudeMem, dryRun);
    for (const change of result.changes) {
      add(
        "companions",
        "changed",
        `${short(result.file)}: ${formatKeyPath(change.path)}: ${shownClaudeMemValue(change.path, change.before)} -> ${shownClaudeMemValue(change.path, change.after)}`,
      );
    }
    // A key that holds the wanted value already is claude-mem's own default (the plan
    // stops at any other value of the person's): nothing worth a line.
    claudeMemChanged = result.changes.length > 0;
  }

  let tmuxAdded = false;
  if (managed.tmuxLine) {
    const line = applyTmuxLine({ dryRun, file: paths.tmuxConfFile, stateDir: paths.stateDir });
    if (line.outcome !== "unchanged") {
      tmuxAdded = true;
      add(
        "terminal",
        line.outcome === "created" ? "created" : "changed",
        `${short(paths.tmuxConfFile)}: added ${TMUX_LINE}`,
      );
    }
  }

  // What an older setup left for Serena, retired: its context file (while no registration
  // still names it) and the serena-root records. Decided here, on each pass, so the dry run
  // and the real run say the same thing.
  const serena = applySerenaCleanup(paths, planSerenaCleanup(paths, takenBack), dryRun);
  lines.push(...reportLines("mcp", serena.changes), ...reportLines("mcp", serena.info));

  const { where, choice } = managed.instructions;
  const optOut = choice === null ? instructionsOptedOut(paths.stateDir) : !choice;
  const stored = choice === null ? null : setInstructionsOptOut(paths.stateDir, optOut, dryRun);
  const instructions = [
    ...(stored ? [stored] : []),
    ...(optOut ? removeInstructions(where, dryRun) : installInstructions(where, dryRun, VERSION)),
  ];
  for (const line of instructions) {
    lines.push(reportLine("instructions", `${line.mark} ${short(line.file)}: ${line.what}`));
  }
  return { lines, tmuxAdded, claudeMemChanged };
}

/** Whether setup printed anything while it asked: a blank line then parts the questions from the report. */
interface Screen {
  spoke: boolean;
}

/**
 * Shows commands that change the system and asks before they run. True to run them.
 * With no terminal, or a "no", it says so (in the report), and they do not run.
 */
function askToRun(
  machine: Machine,
  out: Out,
  screen: Screen,
  what: string,
  commands: readonly string[][],
  rerun: string,
  report: Report,
): boolean {
  screen.spoke = true;
  out.say(`${what}:`);
  for (const command of commands) out.line("run", showCommand(command), { indent: 2 });
  if (machine.confirm === null) {
    report.push({
      section: "terminal",
      mark: "fail",
      text: "Warp: no terminal, so these commands were not run.",
      fix: `run \`${rerun}\` in a terminal`,
    });
    return false;
  }
  if (!machine.confirm("Run these commands now?")) {
    report.push({
      section: "terminal",
      mark: "warn",
      text: "Warp: these commands were not run (you said no).",
    });
    return false;
  }
  return true;
}

/**
 * Runs each command on the terminal, in order; stops at the first that fails. When one
 * fails after others ran, it says what was done, and how to undo it (`undo`).
 */
function runOnTerminal(
  machine: Machine,
  commands: readonly string[][],
  undo: string | null,
  report: Report,
): boolean {
  for (const [index, command] of commands.entries()) {
    const code = machine.runOnTerminal(command);
    if (code === 0) continue;
    const done = commands.slice(0, index);
    report.push({
      section: "terminal",
      mark: "fail",
      text: `${showCommand(command)} failed (exit ${code}). Nothing after it ran.`,
      ...(done.length === 0
        ? {}
        : {
            detail: [
              "These ran before it:",
              ...done.map((ran) => `  $ ${showCommand(ran)}`),
              ...(undo === null ? [] : [`To undo them: ${undo}`]),
            ],
          }),
    });
    return false;
  }
  return true;
}

/** The auto-mode entries a run would write, and the change they make. */
interface AutoModePlan {
  wanted: AutoModeSource;
  added: string[];
  removed: string[];
}

/**
 * The auto-mode entries this project asks for, and the change they make. Null: no
 * project, or the project cannot be read: then the report says why, and setup goes on
 * without them (they are only one part of setup).
 */
function planAutoMode(paths: CliPaths, options: SetupOptions, report: Report): AutoModePlan | null {
  let wanted: AutoModeSource | null;
  try {
    wanted = autoModeSource(options.project, options.machine.which);
  } catch (error) {
    report.push({
      section: "projects",
      mark: "warn",
      text: `auto-mode entries left out: ${messageOf(error)}`,
    });
    return null;
  }
  if (wanted === null) return null;
  const diff = applyAutoMode(paths.settingsFile, paths.stateDir, wanted, true);
  return { wanted, added: diff.added, removed: diff.removed };
}

/**
 * The line a run prints when the auto-mode entries are left out for lack of a terminal.
 * `--yes` never stands in for one: the entries are trust rules, and only a person at a
 * terminal can answer for them.
 */
const AUTO_MODE_NO_TERMINAL: ReportLine = {
  section: "projects",
  mark: "warn",
  text: "auto-mode entries left out: they are trust rules, so setup asks first, on a terminal",
  fix: `run ${COMMAND} setup in a terminal`,
};

/**
 * What this run does about the auto-mode question. The entries are trust rules, so only a
 * person at a terminal answers for them (`--yes` skips the question, never the terminal).
 * This is the one place that decides it, so `--dry-run` and a real run say the same thing:
 *
 * - `ask`: the terminal to ask on, when there is a change to make;
 * - `note`: the line to print instead, when there is a change to make and no terminal;
 * - `ask: false` with no note: nothing to change, so nothing to ask and nothing to say.
 */
function autoModeAsking(
  machine: Machine,
  planned: AutoModePlan,
): { ask: false; note: ReportLine | null } | { ask: true; confirm: (question: string) => boolean } {
  const confirm = machine.confirm;
  if (planned.added.length === 0 && planned.removed.length === 0) return { ask: false, note: null };
  if (confirm === null) return { ask: false, note: AUTO_MODE_NO_TERMINAL };
  return { ask: true, confirm };
}

/**
 * Asks about the auto-mode entries. They are trust rules, so a change is shown first,
 * then asked, always on a terminal: `--yes` skips only the question, and with no terminal
 * they are left out whatever the flags. Null: they are left out in this run.
 */
function askAutoMode(
  paths: CliPaths,
  options: SetupOptions,
  planned: AutoModePlan,
  out: Out,
  screen: Screen,
  report: Report,
): AutoModeSource | null {
  const { wanted, added, removed } = planned;
  if (added.length === 0 && removed.length === 0) return wanted;
  const short = (path: string) => tildify(path, paths.home);
  const from = wanted.file ?? `${wanted.source}/.claude/cc-smart-dev-kit.json`;
  screen.spoke = true;
  out.say(
    `Auto mode: trust rules from ${short(from)} ("autoMode"), for ${formatKeyPath(AUTO_MODE_PATH)} in ${short(paths.settingsFile)}:`,
  );
  if (wanted.differsFrom !== null) {
    out.say(
      `This worktree's file is not the same as the main checkout's (${short(wanted.differsFrom)}). The rules below come from this worktree's file.`,
      2,
    );
  }
  for (const entry of added) out.line("created", JSON.stringify(entry), { indent: 2 });
  for (const entry of removed) out.line("removed", JSON.stringify(entry), { indent: 2 });
  const asking = autoModeAsking(options.machine, planned);
  if (!asking.ask) {
    if (asking.note !== null) report.push(asking.note);
    return null;
  }
  if (options.yes) return wanted;
  if (!asking.confirm("Write these auto-mode entries?")) {
    report.push({
      section: "projects",
      mark: "info",
      text: "auto-mode entries left out (you said no)",
    });
    return null;
  }
  return wanted;
}

/**
 * The status line is offered, never taken: asked only in a terminal, only when none is
 * set, never with `--yes` (it asks nothing it may skip), and never again after a "no"
 * (`statuslineDeclinedFile`); `--statusline` sets it without asking, a "no" before or not.
 * One someone else set stays: with `--statusline`, setup then stops with ForeignKeyError in
 * the read-only pass and writes nothing. Asked with setup's other questions, before anything
 * runs. True when the answer was "no" (to remember); a "yes" sets `managed.statusline`.
 */
function askStatusline(paths: CliPaths, machine: Machine, managed: Managed, yes: boolean): boolean {
  if (
    managed.statusline ||
    yes ||
    machine.confirm === null ||
    hasStatusline(paths.settingsFile) ||
    existsSync(statuslineDeclinedFile(paths.stateDir))
  ) {
    return false;
  }
  managed.statusline = machine.confirm(
    "Show cc-smart-dev-kit's status line in Claude Code (plan usage, a warning from 85 %, and any gateway fallback)?",
  );
  return !managed.statusline;
}

/**
 * D56: Claude Code's retry watchdog is on by default. Nothing asked, on a terminal or not,
 * with `--yes` or not: it is turned on unless a flag already decided, a key of their own is in
 * the settings' `env` (their value stays, as ForeignKeyError rules), or the person said no
 * before (`retryWatchdogDeclinedFile`) and nothing of ours is there. A key an older setup
 * wrote is ours: the run completes it with D56's cap. A "no" beside our own keys is stale (an
 * older `--retry-watchdog` did not remove it): the run turns the keys on and forgets it.
 */
function decideRetryWatchdog(paths: CliPaths, managed: Managed): void {
  if (managed.retryWatchdog !== null) return;
  try {
    const state = retryWatchdogState(paths);
    const keysOurs = retryWatchdogKeysOurs(paths);
    // Ours is on already: complete the keys, and let the write forget a stale "no".
    if (state === "ours" && keysOurs) {
      managed.retryWatchdog = "on";
      return;
    }
    // A key of the person's own decides by itself.
    if (state !== "off") return;
    // Off, and a "no" on file: their answer stands while no key of ours is there.
    if (retryWatchdogDeclined(paths.stateDir)) return;
    if (keysOurs) managed.retryWatchdog = "on";
  } catch {
    // An unreadable file: setup's own pass reports it.
  }
}

/**
 * Said before claude-mem's work state goes off (D23): its to-do lists stop showing in a
 * session, and the person may want to read one last time, or turn it back on (`setup`
 * leaves a value they set alone, also `"true"`).
 */
function workStateWarning(paths: CliPaths): ReportLine {
  return {
    section: "companions",
    mark: "warn",
    text: `claude-mem's work state goes off: its to-do lists are no longer shown in a session. Read one first with claude-mem's work_state_read tool, or turn work state back on by setting ${WORK_STATE_KEY} to "true" in ${tildify(paths.claudeMemSettingsFile, paths.home)}.`,
  };
}

/**
 * The claude-mem keys this run writes, once the backend answered. Null: none. A dry run
 * reaches no network: it says which backend a real run would check.
 */
async function decideClaudeMem(
  paths: CliPaths,
  dryRun: boolean,
  report: Report,
  out: Out,
): Promise<ClaudeMemPlan | null | "not-installed"> {
  const planned = claudeMemPlan(paths);
  if ("notInstalled" in planned) return "not-installed";
  if ("note" in planned) {
    if (planned.note !== null) report.push(reportLine("companions", planned.note));
    return null;
  }
  const plan = planned.plan;
  report.push(...reportLines("companions", plan.notes));
  // A dry run of the plan: what this run would change. No file is written.
  const changes = applyClaudeMem(paths, plan, true).changes;
  if (changes.some((change) => change.path.at(-1) === WORK_STATE_KEY)) {
    report.push(workStateWarning(paths));
  }

  // The backend is asked only when one of the provider keys changes: taking out a retired
  // key, or writing only the two start blocks, needs no answer from it.
  const provider = plan.provider;
  if (provider === null) return plan;
  const providerChanges = changes.some((change) =>
    provider.set.some(([path]) => samePath(path, change.path)),
  );
  if (!providerChanges) return plan;
  if (dryRun) {
    report.push({
      section: "companions",
      mark: "info",
      text: `claude-mem: would check ${provider.target.backend} (one chat request) before writing its settings`,
    });
    return plan;
  }
  const problem = await out.progress(
    `Checking claude-mem's backend (${provider.target.backend})…`,
    () => checkAffordableTarget(provider.target),
  );
  if (problem !== null) {
    // The two start blocks are independent of the backend: they are still written.
    report.push({
      section: "companions",
      mark: "warn",
      text: `claude-mem settings left alone: ${problem}`,
    });
    return { ...plan, provider: null };
  }
  return plan;
}

/**
 * Claude Code's own task tools (D23): `env.CLAUDE_CODE_ENABLE_TODO_TOOLS: "1"` in the user
 * settings, so a session whose claude-mem work state is off has a to-do home. A value the
 * person set themselves is theirs: it stays, and setup names it.
 */
function planTodoTools(
  paths: CliPaths,
): { kind: "set"; path: KeyPath } | { kind: "kept"; path: KeyPath; value: unknown } {
  const path: KeyPath = ["env", TODO_TOOLS_KEY];
  const current = getKey(readJsonObject(paths.settingsFile).data, path);
  if (!current.found || Bun.deepEquals(current.value, TODO_TOOLS_VALUE)) {
    return { kind: "set", path };
  }
  // A key setup wrote before, and the person changed since, is theirs too (`ownership`).
  const records = ownedRecords(paths.stateDir, realTarget(paths.settingsFile));
  return ownership(records, path, current) === "ours"
    ? { kind: "set", path }
    : { kind: "kept", path, value: current.value };
}

/** What `--warp`, `--remove-warp` or plain setup does about Warp. */
interface WarpWork {
  /** System commands, shown and asked before they run. */
  commands: string[][];
  /** Make the files the commands need, right before they run. */
  stage: boolean;
  /** `claude plugin` steps for Warp's plugin. */
  pluginSteps: CompanionStep[];
  removeShortcuts: boolean;
  info: string[];
}

const NO_WARP: WarpWork = {
  commands: [],
  stage: false,
  pluginSteps: [],
  removeShortcuts: false,
  info: [],
};

function planWarp(paths: CliPaths, options: SetupOptions): WarpWork | { error: string } {
  // Plain setup leaves Warp alone: the app and its plugin come only with --warp.
  if (!options.warp && !options.removeWarp) return NO_WARP;
  const machine = options.machine;
  const system = detectSystem(machine);
  const app = detectWarpApp(machine, system);
  const version = app.version === null ? "" : ` ${app.version}`;
  if (options.removeWarp) {
    const commands = warpRemoveCommands(machine, system, app);
    const info: string[] = [];
    const packageManagerRemovesIt =
      system.kind === "apt" || system.kind === "dnf" || (system.kind === "brew" && app.viaBrew);
    if (app.installed && !packageManagerRemovesIt) {
      info.push(
        machine.platform === "darwin"
          ? "! Warp was not installed with Homebrew: move Warp.app from Applications to the Bin by hand"
          : `! Warp${version} was not installed by a package manager cc-smart-dev-kit knows: remove it by hand`,
      );
    }
    return {
      ...NO_WARP,
      commands,
      pluginSteps: warpPluginRemoveSteps(paths),
      removeShortcuts: warpDesktopEntries(paths).length > 0,
      info,
    };
  }
  if (app.installed) {
    return {
      ...NO_WARP,
      pluginSteps: warpPluginSteps(paths),
      info: [`  Warp${version} is installed already`],
    };
  }
  if (system.kind === "none") return { error: system.reason };
  return {
    ...NO_WARP,
    commands: warpInstallCommands(machine, system, paths),
    stage: system.kind === "apt" || system.kind === "dnf",
    pluginSteps: warpPluginSteps(paths),
  };
}

/**
 * The step that puts the launcher's folder on PATH, for this person's shell: the exact line
 * and the file it goes in (UX-7), or Windows' own settings window, where `~` means nothing
 * (`docs/windows-setup.md`). Then a new terminal: the shell reads that file when it starts.
 */
export function pathStep(
  paths: CliPaths,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): NextStep {
  if (platform === "win32") {
    return `Add ${paths.binDir} to your PATH, so the ${COMMAND} command works: Windows Settings → System → About → Advanced system settings → Environment Variables → Path for your account. Then open a new terminal.`;
  }
  const inHome = relative(paths.home, paths.binDir);
  const underHome = inHome !== "" && !inHome.startsWith("..") && !isAbsolute(inHome);
  const shown = tildify(paths.binDir, paths.home);
  const why = `Add ${shown} to your PATH, so the ${COMMAND} command works`;
  const shell = basename(env.SHELL ?? "");
  if (shell === "fish") {
    return {
      text: `${why}: run this once, then open a new terminal:`,
      command: `fish_add_path ${shown}`,
    };
  }
  const file =
    shell === "zsh"
      ? "~/.zshrc"
      : shell === "bash"
        ? platform === "darwin"
          ? "~/.bash_profile"
          : "~/.bashrc"
        : "~/.profile";
  return {
    text: `${why}: add this line to ${file}, then open a new terminal:`,
    command: `export PATH="${underHome ? `$HOME/${inHome}` : paths.binDir}:$PATH"`,
  };
}

/** What a new Claude Code session reads when it starts, said once (and claude-mem's part, when it changed). */
function restartStep(claudeMemChanged: boolean): string {
  const claudeMem = claudeMemChanged
    ? " claude-mem's start hook reads its new settings then too, and its worker reads them when it starts."
    : "";
  return `Start a new Claude Code session (and restart the ones running): a session reads its settings, instructions, plugins and MCP servers when it starts.${claudeMem}`;
}

/** The sections whose changes a running Claude Code session does not see until it restarts. */
const RESTART_SECTIONS: ReadonlySet<SetupSection> = new Set<SetupSection>([
  "settings",
  "instructions",
  "companions",
  "mcp",
  "projects",
]);

export async function runSetup(paths: CliPaths, options: SetupOptions): Promise<number> {
  const short = (path: string) => tildify(path, paths.home);
  const machine = options.machine;
  const out = options.out ?? createOut(currentTerminal(process.env, machine.platform));

  if (!marketplaceKnown(paths.settingsFile)) {
    console.error(
      `${short(paths.settingsFile)} does not list the ${MARKETPLACE} marketplace yet.\n` +
        `Run first: ${MARKETPLACE_ADD_COMMAND}\n` +
        `Then:      ${PLUGIN_INSTALL_COMMAND}`,
    );
    return 1;
  }

  // Plan everything first: nothing is written, run or asked before the read-only pass.
  const warp = planWarp(paths, options);
  if ("error" in warp) {
    console.error(`Cannot install Warp here: ${warp.error}`);
    return 1;
  }
  out.heading(
    options.dryRun
      ? `${COMMAND} ${VERSION}: what setup would change (dry run)`
      : `${COMMAND} ${VERSION}: setting up this machine`,
  );
  out.blank();
  const report: Report = [];
  let ok = true;
  const companions = companionPlan(paths);
  report.push(...reportLines("companions", companions.notes));
  // Warp's plugin steps run with the companions' and print in Warp's own section.
  const warpSteps = new Set(warp.pluginSteps);
  const stepSection = (step: CompanionStep | undefined): SetupSection =>
    step !== undefined && warpSteps.has(step) ? "terminal" : "companions";
  let claudeSteps = [...companions.steps, ...warp.pluginSteps];
  if (claudeSteps.length > 0 && machine.which("claude") === null) {
    // Only these steps need claude: the rest of setup still runs.
    report.push({
      section: "companions",
      mark: "fail",
      text: "The claude command is not on PATH, so setup skipped these steps. Run them once it is:",
      detail: claudeSteps.map((step) => `$ ${showCommand(step.argv)}`),
    });
    claudeSteps = [];
    ok = false;
  }
  const claudeMem = await decideClaudeMem(paths, options.dryRun, report, out);
  const autoMode = planAutoMode(paths, options, report);
  // tmux's passthrough line is for a person who uses tmux: it goes in only when tmux is
  // installed. A running server keeps its own value until the line is applied to it, which
  // setup never does itself: it prints the command to run.
  const tmuxLine = machine.which("tmux") !== null;
  const tmuxRunning = tmuxLine && tmuxServerRunning(machine.run);
  // The Tavily key: from the environment or the settings' own `env` (nothing to write), from
  // `--tavily-key-stdin` or from the key file (an owned secret key in the settings, so Claude
  // Code's "${TAVILY_API_KEY}" gets it), or missing (the server is skipped, with the plan's
  // note). A key is never printed.
  const tavily =
    options.tavilyKeyStdin === null
      ? readTavilyKey(paths, options.env)
      : { source: "file" as const, value: options.tavilyKeyStdin };
  const managed: Managed = {
    claudeMem: claudeMem === "not-installed" ? null : claudeMem,
    autoMode: autoMode?.wanted ?? null,
    instructions: {
      where: instructionsPaths(paths, options.instructionsSource),
      choice: options.instructions,
    },
    statusline: options.statusline,
    retryWatchdog: options.retryWatchdog === null ? null : options.retryWatchdog ? "on" : "off",
    tavilyKeyPlan:
      tavily.source === "file"
        ? { kind: "write", value: tavily.value }
        : tavily.source === "settings"
          ? { kind: "keep" }
          : { kind: "remove" },
    // A key from stdin is written to the key file first: the one home of that key.
    tavilyKeyFile: options.tavilyKeyStdin,
    tmuxLine,
  };

  // The MCP servers: what setup registered last time, what Claude Code holds now, and what to
  // do about each. A server of the person's own is never taken over (`register.ts`); when
  // Claude Code's own config cannot be read, nothing is touched at all. A retired server
  // setup registered itself is taken back the same way (`retired.ts`).
  let records: Record<string, McpRecord> = {};
  let recordsProblem: null | string = null;
  try {
    records = readMcpRecords(paths.stateDir);
  } catch (error) {
    recordsProblem = messageOf(error);
  }
  // Either file unread means nothing is known about the servers, so nothing is touched (ST-5):
  // without the record, every server setup registered would read as someone else's, and a
  // record written now would replace the one that holds what setup really registered.
  const liveServers = recordsProblem === null ? readUserServers(paths.userConfigFile) : null;
  const mcpPlan = [
    ...planMcpServers(
      mcpServers({
        bunx: machine.which("bunx") ?? "bunx",
        launcher: launcherArgv(paths.binDir, machine.platform),
        tavily: tavily.source === "none" ? { key: false, reason: tavily.reason } : { key: true },
      }),
      records,
      liveServers,
    ),
    ...planRetiredServers(records, liveServers, paths),
  ];
  /** The registrations this run would take out: for the dry pass's view of Serena's file. */
  const plannedRemovals = mcpPlan
    .filter((entry) => entry.action === "remove")
    .map((entry) => entry.name);
  // One line, not one per server: nothing was added, removed, updated or forgotten.
  if (recordsProblem !== null) {
    report.push(
      reportLine(
        "mcp",
        unreadableRecordsNote(short(mcpRecordsFile(paths.stateDir)), recordsProblem),
      ),
    );
  } else if (liveServers === null) {
    report.push(
      reportLine(
        "mcp",
        unreadableUserConfigNote(short(paths.userConfigFile), Object.keys(records).sort()),
      ),
    );
  }
  const claudeRun: ClaudeRun = (argv) => {
    const result = machine.run(argv);
    return { ok: result.exitCode === 0, out: result.output };
  };

  // The browser: read-only, and never blocking. Setup prints one line while steps are still open,
  // and names `browser setup` — the command that walks through them, and the one step that opens a
  // Chrome window — as a next step. Nothing here starts Chrome, asks a question, or fails setup: a
  // browser that is not ready is reported, never waited for.
  const browser = browserSetupReport(paths, realBrowserSetupDeps(machine, paths.home));
  report.push(...reportLines("browser", browser.info), ...reportLines("browser", browser.notes));

  // The repos the saved sessions name that still carry a piece of the retired worktree engine
  // (D33): one `!` line each, with the `project init` that takes it out. Read-only: setup never
  // changes another repo.
  report.push(...reportLines("projects", retiredRepoLines(paths, options.env)));

  // D56: the retry watchdog is on by default. A flag, a "no" on file, or a key of the
  // person's own already decides it; anything else turns it on here, before the read-only
  // pass, so a value of theirs that setup may not take still stops it in that pass.
  decideRetryWatchdog(paths, managed);
  // A read-only pass: a key the user set (autoUpdate: true) throws ForeignKeyError here,
  // before anything is asked, written or run, the launcher and the state folder included.
  const planned = applySetup(paths, managed, true, plannedRemovals, machine.platform);
  const tmuxNow = `tmux is running: run \`${TMUX_NOW_COMMAND}\` to apply the line now (a restart works too)`;

  if (options.dryRun) {
    const wouldRegister = applyMcpServers(mcpPlan, claudeRun, machine.which, true, () => {});
    report.push(
      ...warp.commands.map(
        (command): ReportLine => ({ section: "terminal", mark: "run", text: showCommand(command) }),
      ),
      ...claudeSteps.map((step) => reportLine(stepSection(step), step.line)),
      ...reportLines("terminal", warp.removeShortcuts ? removeWarpDesktopEntries(paths, true) : []),
      ...reportLines("mcp", wouldRegister.wouldRun),
      ...planned.lines,
      ...reportLines("terminal", warp.info),
      ...reportLines("mcp", wouldRegister.notes),
    );
    // The entries above are left out in a run with no terminal, whatever the flags: the
    // dry run says so in the same words a real run prints (`autoModeAsking`).
    if (autoMode !== null) {
      const asking = autoModeAsking(machine, autoMode);
      if (!asking.ask && asking.note !== null) report.push(asking.note);
    }
    if (planned.tmuxAdded && tmuxRunning) {
      report.push({ section: "terminal", mark: "info", text: tmuxNow });
    }
    const counts = printSections(out, report, true);
    out.blank();
    const verdict = setupVerdict(counts, { dryRun: true, ok, backups: null });
    out.verdict(verdict.mark, verdict.text);
    out.say(dryRunEnding(["written", "run"]));
    return 0;
  }

  // Every question before anything runs. A "no" to one leaves the others as answered;
  // only what depends on it goes (Warp's plugin and shortcuts go with Warp's commands).
  const screen: Screen = { spoke: false };
  const confirm = machine.confirm;
  const asking: Machine = {
    ...machine,
    confirm:
      confirm === null
        ? null
        : (question) => {
            screen.spoke = true;
            return confirm(question);
          },
  };
  if (autoMode !== null) {
    managed.autoMode = askAutoMode(
      paths,
      { ...options, machine: asking },
      autoMode,
      out,
      screen,
      report,
    );
  }
  const declined = askStatusline(paths, asking, managed, options.yes);
  // `--no-retry-watchdog` is a "no": remembered, so a later plain setup leaves the keys out.
  const watchdogDeclined = options.retryWatchdog === false;
  let warpYes = true;
  if (warp.commands.length > 0) {
    const what = options.removeWarp
      ? `To remove Warp, ${COMMAND} runs these commands (sudo asks for your password)`
      : `To install Warp from its signed source, ${COMMAND} runs these commands (sudo asks for your password)`;
    const rerun = options.removeWarp ? `${COMMAND} setup --remove-warp` : `${COMMAND} setup --warp`;
    warpYes = askToRun(asking, out, screen, what, warp.commands, rerun, report);
  }
  if (screen.spoke) out.blank();

  let warpDone = warpYes;
  if (warp.commands.length > 0 && warpYes) {
    try {
      if (warp.stage) await stageWarpFiles(machine, detectSystem(machine), paths);
      const undo = options.removeWarp ? null : `${COMMAND} setup --remove-warp`;
      warpDone = runOnTerminal(machine, warp.commands, undo, report);
    } catch (error) {
      report.push({
        section: "terminal",
        mark: "fail",
        text: `${messageOf(error)}. No Warp command was run.`,
      });
      warpDone = false;
    } finally {
      if (warp.stage) clearWarpStage(paths);
    }
  }
  if (!warpDone) {
    ok = false;
    // Warp's plugin and shortcuts follow the app: none of them without it.
    claudeSteps = claudeSteps.filter((step) => !warpSteps.has(step));
  }

  report.push(...reportLines("terminal", warp.info));
  if (claudeSteps.length > 0) {
    const ran = claudeSteps;
    const steps = await out.progress("Adding the companion plugins…", async () =>
      runCompanionSteps(ran, machine),
    );
    // One line per step, in the steps' order. A step's `!` line is its failure (Claude Code's
    // own words, `runCompanionSteps`), and the run exits 1 for it: a ✗, not a warning.
    report.push(
      ...steps.lines.map((line, index): ReportLine => {
        const read = reportLine(stepSection(ran[index]), line);
        return read.mark === "warn" ? { ...read, mark: "fail" } : read;
      }),
    );
    if (!steps.ok) ok = false;
  }

  // The first run: claude-mem came with a companion step just now, so plan it again. Before
  // the lock: it asks the backend over the network.
  if (claudeMem === "not-installed" && claudeSteps.length > 0) {
    const again = await decideClaudeMem(paths, false, report, out);
    if (again !== "not-installed") managed.claudeMem = again;
  }

  const now = new Date().toISOString();
  const written = await out.progress("Registering the MCP servers and writing the settings…", () =>
    withLock(
      paths.stateDir,
      () => {
        // The MCP servers, at user scope, through Claude Code's own `claude mcp` commands —
        // inside the lock, with each add's or update's record written before its first command
        // (`markMcpServerAdding`): a run that dies after an add, or that would find the lock
        // busy, can no longer leave a server registered with no record of it (ST-4).
        const mcp = applyMcpServers(mcpPlan, claudeRun, machine.which, false, (name, json) => {
          markMcpServerAdding(paths.stateDir, name, json, now);
        });
        const shortcuts =
          warp.removeShortcuts && warpDone ? removeWarpDesktopEntries(paths, false) : [];
        // Only what was really taken out counts: a `claude mcp remove` that failed leaves the
        // registration, and whatever it names, where it was.
        const files = applySetup(paths, managed, false, mcp.removed, machine.platform);
        // Which servers setup registered: cc-smart-dev-kit's own state, like the lock — not a
        // user file, so no backup (restore reads it to take exactly those back).
        recordApplied(paths.stateDir, mcp, now);
        // cc-smart-dev-kit's own state, like the lock: not a user file, so no backup.
        if (declined) atomicWrite(statuslineDeclinedFile(paths.stateDir), "no\n", 0o600);
        if (watchdogDeclined) {
          atomicWrite(retryWatchdogDeclinedFile(paths.stateDir), "no\n", 0o600);
        }
        // The watchdog is on after this run (`--retry-watchdog`, or ours already on): a "no"
        // an older run left behind goes, so the state agrees with the keys.
        if (managed.retryWatchdog === "on") {
          rmSync(retryWatchdogDeclinedFile(paths.stateDir), { force: true });
        }
        return {
          mcp,
          files: { ...files, lines: [...reportLines("terminal", shortcuts), ...files.lines] },
        };
      },
      { waitMs: 10_000 },
    ),
  );
  report.push(
    ...reportLines("mcp", written.mcp.changes),
    ...reportLines("mcp", written.mcp.notes),
    ...written.files.lines,
  );
  if (!written.mcp.ok) ok = false;

  const counts = printSections(out, report, false);
  // A file was written: each one has its backup (the MCP registrations are Claude Code's own).
  const filesWritten = written.files.lines.some((line) => CHANGE_MARKS.has(line.mark));
  out.blank();
  const verdict = setupVerdict(counts, {
    dryRun: false,
    ok,
    backups: filesWritten ? `${short(paths.stateDir)}/backups/` : null,
  });
  out.verdict(verdict.mark, verdict.text);

  // What the person does now, in order: the command on PATH first (the steps after it use it),
  // then what applies a change to a program that runs now, then a new Claude Code session.
  const next: NextStep[] = [];
  if (!(options.env.PATH ?? "").split(delimiter).includes(paths.binDir)) {
    next.push(pathStep(paths, machine.platform, options.env));
  }
  if (written.files.tmuxAdded && tmuxRunning) {
    next.push({
      text: "Apply the tmux line to the tmux server that runs now (a restart of tmux works too):",
      command: TMUX_NOW_COMMAND,
    });
  }
  if (browser.next !== null) next.push(browser.next);
  if (report.some((line) => CHANGE_MARKS.has(line.mark) && RESTART_SECTIONS.has(line.section))) {
    next.push(restartStep(written.files.claudeMemChanged));
  }
  if (next.length > 0) {
    out.blank();
    out.next(next);
  }
  return ok ? 0 : 1;
}

/** What the report holds, counted: the verdict reads it. */
interface ReportCounts {
  changes: number;
  fail: number;
  warn: number;
  info: number;
}

function countLines(lines: readonly ReportLine[]): ReportCounts {
  const counts: ReportCounts = { changes: 0, fail: 0, warn: 0, info: 0 };
  for (const line of lines) {
    if (CHANGE_MARKS.has(line.mark)) counts.changes += 1;
    else if (line.mark === "fail") counts.fail += 1;
    else if (line.mark === "warn") counts.warn += 1;
    else counts.info += 1;
  }
  return counts;
}

/** Changes first, then information, then what to read or fix: the order inside a section. */
function lineRank(line: ReportLine): number {
  if (CHANGE_MARKS.has(line.mark)) return 0;
  return line.mark === "fail" || line.mark === "warn" ? 2 : 1;
}

/**
 * A section's line: its worst line's mark, and what it holds in words — what it changed first,
 * the run's own news ("2 changes, 1 warning").
 */
function sectionHeader(counts: ReportCounts, dryRun: boolean): { mark: Mark; summary: string } {
  const summary = [
    counts.changes > 0
      ? dryRun
        ? `${counts.changes} to change`
        : plural(counts.changes, "change", "changes")
      : null,
    counts.fail > 0 ? `${counts.fail} to fix` : null,
    counts.warn > 0 ? plural(counts.warn, "warning", "warnings") : null,
    counts.info > 0 ? plural(counts.info, "note", "notes") : null,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
  const mark: Mark =
    counts.fail > 0
      ? "fail"
      : counts.warn > 0
        ? "warn"
        : !dryRun && counts.changes > 0
          ? "ok"
          : "info";
  return { mark, summary };
}

/**
 * The report, section by section in `SETUP_SECTIONS`' order: a section's own line, then its
 * lines — changes, then information, then warnings — each with its mark. A section with
 * nothing to say is left out. Returns the counts of the whole report.
 */
function printSections(out: Out, report: Report, dryRun: boolean): ReportCounts {
  const titleWidth = Math.max(...SETUP_SECTIONS.map((section) => section.title.length));
  for (const { id, title } of SETUP_SECTIONS) {
    const lines = report
      .filter((line) => line.section === id)
      .sort((a, b) => lineRank(a) - lineRank(b));
    if (lines.length === 0) continue;
    const { mark, summary } = sectionHeader(countLines(lines), dryRun);
    out.group(
      { mark, summary, title, titleWidth },
      lines.map((line) => ({
        mark: line.mark,
        text: line.text,
        fix: line.fix,
        detail: line.detail,
      })),
    );
  }
  return countLines(report);
}

/**
 * The report's last line: what the run did, in words. `backups`: the folder the changed files'
 * backups are in, when a file was written.
 */
export function setupVerdict(
  counts: ReportCounts,
  run: { dryRun: boolean; ok: boolean; backups: string | null },
): { mark: Mark; text: string } {
  const changes = plural(counts.changes, "change", "changes");
  const warnings = plural(counts.warn, "warning", "warnings");
  if (run.dryRun) {
    return {
      mark: "info",
      text:
        counts.changes > 0
          ? `A real run makes ${changes}.`
          : "Nothing to change. Setup is up to date.",
    };
  }
  const backups = run.backups === null ? "" : ` Each changed file has a backup in ${run.backups}.`;
  if (!run.ok) {
    return {
      mark: "fail",
      text: `Setup is not finished: do what the ✗ and ! lines above say, then run ${COMMAND} setup again.${backups}`,
    };
  }
  const done = counts.changes > 0 ? `Done: ${changes}` : "Nothing to change. Setup is up to date";
  return counts.warn > 0
    ? { mark: "warn", text: `${done}, with ${warnings} to read above.${backups}` }
    : { mark: "ok", text: `${done}.${backups}` };
}
