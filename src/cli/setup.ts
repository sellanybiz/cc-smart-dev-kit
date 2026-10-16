import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { browserSetupReport, realBrowserSetupDeps } from "../browser/setup";
import {
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
import { type McpRecord, markMcpServerPending, readMcpRecords } from "../mcp/records";
import {
  applyMcpServers,
  type ClaudeRun,
  planMcpServers,
  readUserServers,
  recordApplied,
  unreadableUserConfigNote,
} from "../mcp/register";
import { installSerenaContext, serenaContextSource } from "../mcp/serena-context";
import { mcpServers } from "../mcp/servers";
import { readTavilyKey, TAVILY_ENV_KEY } from "../mcp/tavily";
import {
  AUTO_MODE_PATH,
  type AutoModeSource,
  applyAutoMode,
  autoModeSource,
} from "../setup/auto-mode";
import {
  type InstructionsPaths,
  installInstructions,
  instructionsOptedOut,
  instructionsPaths,
  removeInstructions,
  setInstructionsOptOut,
} from "../setup/instructions";
import { installLauncher, LAUNCHER_NAME } from "../setup/launcher";
import { installLauncherCmd } from "../setup/launcher-cmd";
import { withLock } from "../setup/lock";
import {
  applyManagedJson,
  createdObjects,
  formatKeyPath,
  type KeyPath,
  ownedKeys,
} from "../setup/managed-json";
import { applyTmuxLine, TMUX_LINE, TMUX_NOW_COMMAND, tmuxServerRunning } from "../setup/tmux";
import { atomicWrite, realTarget } from "../setup/write";
import { type CliPaths, tildify } from "./paths";

/** The key that turns on auto-update for the cc-smart-dev-kit marketplace. Claude Code's install leaves it out. */
export const AUTO_UPDATE_KEY: KeyPath = ["extraKnownMarketplaces", MARKETPLACE, "autoUpdate"];

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
  /** The plugin's `serena` folder, beside `dist/`: the context Serena is registered with. */
  serenaSource: string;
  /** `--statusline`: set the status line without asking. */
  statusline: boolean;
  /** The environment: the Tavily key may come from it (`TAVILY_API_KEY`). */
  env: Record<string, string | undefined>;
  /**
   * `--tavily-key-stdin`: the Tavily key, which arrived on stdin. setup writes it to the key
   * file a person may write by hand (mode 0600, the plugin's own atomic writer) and then
   * treats it as a key from that file, so a later setup keeps it. Never an argument: a
   * command line is readable in `/proc` and lands in the shell's history.
   */
  tavilyKeyStdin: null | string;
}

function show(value: unknown): string {
  return value === undefined ? "(none)" : JSON.stringify(value);
}

/** The settings key setup may write the Tavily key into (an owned secret key). */
export const TAVILY_KEY_PATH: KeyPath = ["env", TAVILY_ENV_KEY];

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
    const settings = JSON.parse(readFileSync(settingsFile, "utf8")) as {
      extraKnownMarketplaces?: Record<string, unknown>;
    };
    const entry = settings.extraKnownMarketplaces?.[MARKETPLACE];
    return typeof entry === "object" && entry !== null;
  } catch {
    return false;
  }
}

/** Claude Code's status line setting, an owned key when setup sets it. */
export const STATUSLINE_KEY: KeyPath = ["statusLine"];

/** Says the person answered "no" to the status line: setup does not ask again. */
export function statuslineDeclinedFile(stateDir: string): string {
  return join(stateDir, "statusline-declined");
}

/** A path as one word for the shell that runs the status line command. */
function shellWord(path: string): string {
  return /^[\w./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
}

/** The status line setting: the launcher, so it follows plugin updates. */
export function statuslineSetting(paths: CliPaths): Record<string, string> {
  return { command: `${shellWord(join(paths.binDir, LAUNCHER_NAME))} statusline`, type: "command" };
}

/** True when settings.json has a `statusLine` of any kind. */
function hasStatusline(settingsFile: string): boolean {
  if (!existsSync(settingsFile)) return false;
  try {
    const settings = JSON.parse(readFileSync(settingsFile, "utf8")) as Record<string, unknown>;
    return Object.hasOwn(settings, "statusLine");
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
  /** Install Serena's context beside the plugin's data (the file its registration names). */
  serena: boolean;
  /** The Tavily key to write into the settings as an owned secret, or null. */
  tavilyKey: null | string;
  /** The Tavily key that arrived on stdin, to write to the key file first, or null. */
  tavilyKeyFile: null | string;
  /** Add tmux's passthrough line (`tmux` is installed, so the person uses tmux). */
  tmuxLine: boolean;
}

/** What setup prints: changes, then information, then notes (warnings and choices). */
interface Report {
  /** One line per change: `+`, `~` or `-` (and `$` for a command, in a dry run). */
  changes: string[];
  /** Information: what was left alone, and why. Never a change. */
  info: string[];
  /** Warnings (`!`) and what the person chose. */
  notes: string[];
}

/** Every change setup makes to files, in order. With `dryRun`, it only reports them. */
function applySetup(
  paths: CliPaths,
  managed: Managed,
  dryRun: boolean,
  serenaSource: string,
  platform: NodeJS.Platform,
): { changes: string[]; info: string[]; notes: string[] } {
  const short = (path: string) => tildify(path, paths.home);
  const changes: string[] = [];
  const info: string[] = [];
  const launcher = installLauncher(paths.binDir, {
    stateDir: paths.stateDir,
    bunPath: process.execPath,
    dryRun,
  });
  if (launcher.outcome !== "unchanged") {
    const mark = launcher.outcome === "created" ? "+" : "~";
    changes.push(`${mark} ${short(launcher.path)}: launcher ${launcher.outcome}`);
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
      const mark = cmd.outcome === "created" ? "+" : "~";
      changes.push(`${mark} ${short(cmd.path)}: launcher ${cmd.outcome}`);
    }
  }

  // The Tavily key that came on stdin goes to the key file a person may write by hand: the
  // one home of that key, mode 0600, written atomically. From then on setup reads the key
  // from there, so a later run keeps it, and `restore` leaves the file (it is the person's
  // key, not a settings key setup owns).
  if (managed.tavilyKeyFile !== null) {
    const mark = existsSync(paths.tavilyKeyFile) ? "~" : "+";
    if (!dryRun) {
      mkdirSync(dirname(paths.tavilyKeyFile), { mode: 0o700, recursive: true });
      atomicWrite(paths.tavilyKeyFile, `${managed.tavilyKeyFile}\n`, 0o600);
    }
    changes.push(`${mark} ${short(paths.tavilyKeyFile)}: the Tavily key (a secret, mode 600)`);
  }

  const set: (readonly [KeyPath, unknown])[] = [[AUTO_UPDATE_KEY, true]];
  if (managed.statusline) set.push([STATUSLINE_KEY, statuslineSetting(paths)]);
  if (managed.tavilyKey !== null) set.push([TAVILY_KEY_PATH, managed.tavilyKey]);
  // The key's source moved: the environment has it now (or there is no key at all), so the
  // key cc-smart-dev-kit wrote into the settings goes — the person's environment must not be
  // shadowed by a stale copy. Only while the key still holds what cc-smart-dev-kit wrote:
  // one the person changed is theirs (`applyManagedJson`).
  const tavilyOwned =
    managed.tavilyKey === null &&
    ownedKeys(paths.stateDir, realTarget(paths.settingsFile)).some(
      (path) => formatKeyPath(path) === formatKeyPath(TAVILY_KEY_PATH),
    );
  const settings = applyManagedJson({
    file: paths.settingsFile,
    stateDir: paths.stateDir,
    // The Tavily key is a secret: errors say "a secret", owned.json keeps only its SHA-256,
    // and the settings file is left at mode 600.
    secret: (path) => formatKeyPath(path) === formatKeyPath(TAVILY_KEY_PATH),
    set,
    ...(tavilyOwned ? { remove: [TAVILY_KEY_PATH] } : {}),
    // An `env` setup created goes with its last key; one the person had stays.
    createdObject: createdObjects(paths.stateDir, paths.settingsFile),
    dryRun,
  });
  for (const change of settings.changes) {
    changes.push(
      `~ ${short(settings.file)}: ${formatKeyPath(change.path)}: ${shownValue(change.path, change.before)} -> ${shownValue(change.path, change.after)}`,
    );
  }
  for (const skip of settings.skipped) {
    info.push(`  ${short(settings.file)}: ${formatKeyPath(skip.path)}: ${skip.reason}`);
  }

  const serenaLines: { mark: "+" | "~" | "!"; text: string }[] = [];
  if (managed.serena) {
    const serena = installSerenaContext(
      serenaSource,
      paths.serenaContextFile,
      paths.stateDir,
      dryRun,
    );
    if (serena.outcome === "missing") {
      serenaLines.push({
        mark: "!",
        text: `Serena's context file is missing from the plugin (${serenaSource}): Serena was not registered. Reinstall the plugin.`,
      });
    } else if (serena.outcome !== "unchanged") {
      serenaLines.push({
        mark: serena.outcome === "created" ? "+" : "~",
        text: `${short(serena.file)}: Serena's context (project switching on)`,
      });
    }
  }

  if (managed.autoMode !== null) {
    const result = applyAutoMode(paths.settingsFile, paths.stateDir, managed.autoMode, dryRun);
    const where = `${short(result.file)}: ${formatKeyPath(AUTO_MODE_PATH)}`;
    for (const entry of result.added) changes.push(`~ ${where}: added ${JSON.stringify(entry)}`);
    for (const entry of result.removed) {
      changes.push(`~ ${where}: removed ${JSON.stringify(entry)}`);
    }
    for (const entry of result.skipped) {
      info.push(
        `  ${where}: ${JSON.stringify(entry)} is there already (not cc-smart-dev-kit's); left alone`,
      );
    }
  }

  if (managed.claudeMem !== null) {
    const result = applyClaudeMem(paths, managed.claudeMem, dryRun);
    for (const change of result.changes) {
      changes.push(
        `~ ${short(result.file)}: ${formatKeyPath(change.path)}: ${shownClaudeMemValue(change.path, change.before)} -> ${shownClaudeMemValue(change.path, change.after)}`,
      );
    }
    // A key that holds the wanted value already is claude-mem's own default (the plan
    // stops at any other value of the person's): nothing worth a line.
  }

  if (managed.tmuxLine) {
    const line = applyTmuxLine({ dryRun, file: paths.tmuxConfFile, stateDir: paths.stateDir });
    if (line.outcome !== "unchanged") {
      const mark = line.outcome === "created" ? "+" : "~";
      changes.push(`${mark} ${short(paths.tmuxConfFile)}: added ${TMUX_LINE}`);
    }
  }

  const { where, choice } = managed.instructions;
  const optOut = choice === null ? instructionsOptedOut(paths.stateDir) : !choice;
  const stored = choice === null ? null : setInstructionsOptOut(paths.stateDir, optOut, dryRun);
  const instructions = [
    ...(stored ? [stored] : []),
    ...(optOut ? removeInstructions(where, dryRun) : installInstructions(where, dryRun, VERSION)),
  ];
  const notes: string[] = [];
  for (const line of serenaLines) {
    (line.mark === "!" ? notes : changes).push(`${line.mark} ${line.text}`);
  }
  for (const line of instructions) {
    (line.mark === "!" ? notes : changes).push(`${line.mark} ${short(line.file)}: ${line.what}`);
  }
  return { changes, info, notes };
}

/**
 * Shows commands that change the system and asks before they run. True to run them.
 * With no terminal, or a "no", it says so (in `notes`), and they do not run.
 */
function askToRun(
  machine: Machine,
  what: string,
  commands: readonly string[][],
  rerun: string,
  notes: string[],
): boolean {
  console.log(`${what}:`);
  for (const command of commands) console.log(`  $ ${showCommand(command)}`);
  if (machine.confirm === null) {
    notes.push(
      `! Warp: no terminal, so these commands were not run. Run \`${rerun}\` in a terminal to run them.`,
    );
    return false;
  }
  if (!machine.confirm("Run these commands now?")) {
    notes.push("! Warp: these commands were not run (you said no).");
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
  notes: string[],
): boolean {
  for (const [index, command] of commands.entries()) {
    const code = machine.runOnTerminal(command);
    if (code === 0) continue;
    notes.push(`! ${showCommand(command)} failed (exit ${code}). Nothing after it ran.`);
    const done = commands.slice(0, index);
    if (done.length > 0) {
      notes.push(
        "  These ran before it:",
        ...done.map((ran) => `    $ ${showCommand(ran)}`),
        ...(undo === null ? [] : [`  To undo them: ${undo}`]),
      );
    }
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
 * project, or the project cannot be read: then `notes` says why, and setup goes on
 * without them (they are only one part of setup).
 */
function planAutoMode(
  paths: CliPaths,
  options: SetupOptions,
  notes: string[],
): AutoModePlan | null {
  let wanted: AutoModeSource | null;
  try {
    wanted = autoModeSource(options.project, options.machine.which);
  } catch (error) {
    notes.push(`! auto-mode entries left out: ${messageOf(error)}`);
    return null;
  }
  if (wanted === null) return null;
  const diff = applyAutoMode(paths.settingsFile, paths.stateDir, wanted, true);
  return { wanted, added: diff.added, removed: diff.removed };
}

/**
 * The note a run prints when the auto-mode entries are left out for lack of a terminal.
 * `--yes` never stands in for one: the entries are trust rules, and only a person at a
 * terminal can answer for them.
 */
const AUTO_MODE_NO_TERMINAL_NOTE =
  "! auto-mode entries left out: they are trust rules, so setup asks first, on a terminal. Run cc-smart-dev-kit setup in a terminal.";

/**
 * What this run does about the auto-mode question. The entries are trust rules, so only a
 * person at a terminal answers for them (`--yes` skips the question, never the terminal).
 * This is the one place that decides it, so `--dry-run` and a real run say the same thing:
 *
 * - `ask`: the terminal to ask on, when there is a change to make;
 * - `note`: the note to print instead, when there is a change to make and no terminal;
 * - `ask: false` with no note: nothing to change, so nothing to ask and nothing to say.
 */
function autoModeAsking(
  machine: Machine,
  planned: AutoModePlan,
): { ask: false; note: string | null } | { ask: true; confirm: (question: string) => boolean } {
  const confirm = machine.confirm;
  if (planned.added.length === 0 && planned.removed.length === 0) return { ask: false, note: null };
  if (confirm === null) return { ask: false, note: AUTO_MODE_NO_TERMINAL_NOTE };
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
  notes: string[],
): AutoModeSource | null {
  const { wanted, added, removed } = planned;
  if (added.length === 0 && removed.length === 0) return wanted;
  const short = (path: string) => tildify(path, paths.home);
  const from = wanted.file ?? `${wanted.source}/.claude/cc-smart-dev-kit.json`;
  console.log(
    `Auto mode: trust rules from ${short(from)} ("autoMode"), for ${formatKeyPath(AUTO_MODE_PATH)} in ${short(paths.settingsFile)}:`,
  );
  if (wanted.differsFrom !== null) {
    console.log(
      `  This worktree's file is not the same as the main checkout's (${short(wanted.differsFrom)}). The rules below come from this worktree's file.`,
    );
  }
  for (const entry of added) console.log(`  + ${JSON.stringify(entry)}`);
  for (const entry of removed) console.log(`  - ${JSON.stringify(entry)}`);
  const asking = autoModeAsking(options.machine, planned);
  if (!asking.ask) {
    if (asking.note !== null) notes.push(asking.note);
    return null;
  }
  if (options.yes) return wanted;
  if (!asking.confirm("Write these auto-mode entries?")) {
    notes.push("  auto-mode entries left out (you said no)");
    return null;
  }
  return wanted;
}

/**
 * The status line is offered, never taken: asked only in a terminal, only when none is
 * set, and never again after a "no" (`statuslineDeclinedFile`); `--statusline` sets it
 * without asking, a "no" before or not. One someone else set stays: with `--statusline`,
 * setup then stops with ForeignKeyError in the read-only pass and writes nothing. Asked
 * with setup's other questions, before anything runs. True when the answer was "no" (to
 * remember); a "yes" sets `managed.statusline`.
 */
function askStatusline(paths: CliPaths, machine: Machine, managed: Managed): boolean {
  if (
    managed.statusline ||
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
 * The claude-mem keys this run writes, once the backend answered. Null: none. A dry run
 * reaches no network: it says which backend a real run would check.
 */
async function decideClaudeMem(
  paths: CliPaths,
  dryRun: boolean,
  report: Report,
): Promise<ClaudeMemPlan | null | "not-installed"> {
  const planned = claudeMemPlan(paths);
  if ("notInstalled" in planned) return "not-installed";
  if ("note" in planned) {
    if (planned.note !== null) report.notes.push(planned.note);
    return null;
  }
  // Nothing to change: no need to ask the backend.
  if (applyClaudeMem(paths, planned.plan, true).changes.length === 0) return planned.plan;
  if (dryRun) {
    report.info.push(
      `  claude-mem: would check ${planned.plan.target.backend} (one chat request) before writing its settings`,
    );
    return planned.plan;
  }
  const problem = await checkAffordableTarget(planned.plan.target);
  if (problem !== null) {
    report.notes.push(`! claude-mem settings left alone: ${problem}`);
    return null;
  }
  return planned.plan;
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

export async function runSetup(paths: CliPaths, options: SetupOptions): Promise<number> {
  const short = (path: string) => tildify(path, paths.home);
  const machine = options.machine;

  if (!marketplaceKnown(paths.settingsFile)) {
    console.error(
      `${short(paths.settingsFile)} does not list the ${MARKETPLACE} marketplace yet.\n` +
        `Run first: ${MARKETPLACE_ADD_COMMAND}\n` +
        `Then:      ${PLUGIN_INSTALL_COMMAND}`,
    );
    return 1;
  }

  // Plan everything first: nothing is written, run or asked before the read-only pass.
  const report: Report = { changes: [], info: [], notes: [] };
  let ok = true;
  const warp = planWarp(paths, options);
  if ("error" in warp) {
    console.error(`Cannot install Warp here: ${warp.error}`);
    return 1;
  }
  const companions = companionPlan(paths);
  report.notes.push(...companions.notes);
  let claudeSteps = [...companions.steps, ...warp.pluginSteps];
  if (claudeSteps.length > 0 && machine.which("claude") === null) {
    // Only these steps need claude: the rest of setup still runs.
    report.notes.push(
      "! The claude command is not on PATH, so setup skipped these steps. Run them once it is:",
      ...claudeSteps.map((step) => `  $ ${showCommand(step.argv)}`),
    );
    claudeSteps = [];
    ok = false;
  }
  const claudeMem = await decideClaudeMem(paths, options.dryRun, report);
  const autoMode = planAutoMode(paths, options, report.notes);
  // tmux's passthrough line is for a person who uses tmux: it goes in only when tmux is
  // installed. A running server keeps its own value until the line is applied to it, which
  // setup never does itself: it prints the command to run.
  const tmuxLine = machine.which("tmux") !== null;
  if (tmuxLine && tmuxServerRunning(machine.run)) {
    report.info.push(
      `  tmux is running: run \`${TMUX_NOW_COMMAND}\` to apply the line now (a restart works too)`,
    );
  }
  // The Tavily key: from the environment (nothing to write), from `--tavily-key-stdin` or
  // from the key file (an owned secret key in the settings, so Claude Code's
  // "${TAVILY_API_KEY}" gets it), or missing (the server is skipped, with the plan's note).
  // A key is never printed.
  const tavily =
    options.tavilyKeyStdin === null
      ? readTavilyKey(paths, options.env)
      : { source: "file" as const, value: options.tavilyKeyStdin };
  const serenaSource = serenaContextSource(options.serenaSource);
  const managed: Managed = {
    claudeMem: claudeMem === "not-installed" ? null : claudeMem,
    autoMode: autoMode?.wanted ?? null,
    instructions: {
      where: instructionsPaths(paths, options.instructionsSource),
      choice: options.instructions,
    },
    serena: existsSync(serenaSource),
    statusline: options.statusline,
    tavilyKey: tavily.source === "file" ? tavily.value : null,
    // A key from stdin is written to the key file first: the one home of that key.
    tavilyKeyFile: options.tavilyKeyStdin,
    tmuxLine,
  };

  // The MCP servers: what setup registered last time, what Claude Code holds now, and what to
  // do about each. A server of the person's own is never taken over (`register.ts`); when
  // Claude Code's own config cannot be read, nothing is touched at all.
  let records: Record<string, McpRecord> = {};
  try {
    records = readMcpRecords(paths.stateDir);
  } catch (error) {
    report.notes.push(
      `! the MCP servers cc-smart-dev-kit registered cannot be read back (${messageOf(error)}): they are registered again`,
    );
  }
  const liveServers = readUserServers(paths.userConfigFile);
  const mcpPlan = planMcpServers(
    mcpServers({
      bunx: machine.which("bunx") ?? "bunx",
      launcher: join(paths.binDir, LAUNCHER_NAME),
      serenaContextFile: paths.serenaContextFile,
      tavily: tavily.source === "none" ? { key: false, reason: tavily.reason } : { key: true },
    }),
    records,
    liveServers,
  ).map((entry) =>
    // A registration that names a context file which is not in place would replace a Serena
    // that starts with one that does not: the existing registration is left as it is.
    entry.name === "serena" && !managed.serena
      ? {
          ...entry,
          action: "skip" as const,
          json: "",
          note: "! serena: the plugin's context file is missing, so your existing registration is left as it is",
        }
      : entry,
  );
  // One line, not one per server: nothing was added, removed, updated or forgotten.
  if (liveServers === null) {
    report.notes.push(
      unreadableUserConfigNote(short(paths.userConfigFile), Object.keys(records).sort()),
    );
  }
  const claudeRun: ClaudeRun = (argv) => {
    const result = machine.run(argv);
    return { ok: result.exitCode === 0, out: result.output };
  };

  // The browser: read-only, and never blocking. Setup prints where the browser's own setup stands
  // — including the guide, when steps are still open — and names `browser setup` for the one step
  // that opens a Chrome window. Nothing here starts Chrome, asks a question, or fails setup: a
  // browser that is not ready is reported, never waited for.
  const browser = browserSetupReport(paths, realBrowserSetupDeps(machine, paths.home));
  report.info.push(...browser.info);
  report.notes.push(...browser.notes);

  // A read-only pass: a key the user set (autoUpdate: false) throws ForeignKeyError here,
  // before anything is asked, written or run, the launcher and the state folder included.
  const planned = applySetup(paths, managed, true, serenaSource, machine.platform);

  if (options.dryRun) {
    const wouldRegister = applyMcpServers(mcpPlan, claudeRun, machine.which, true, () => {});
    const changes = [
      ...warp.commands.map((command) => `$ ${showCommand(command)}`),
      ...claudeSteps.map((step) => step.line),
      ...(warp.removeShortcuts ? removeWarpDesktopEntries(paths, true) : []),
      ...wouldRegister.wouldRun,
      ...planned.changes,
    ];
    // The entries above are left out in a run with no terminal, whatever the flags: the
    // dry run says so in the same words a real run prints (`autoModeAsking`).
    if (autoMode !== null) {
      const asking = autoModeAsking(machine, autoMode);
      if (!asking.ask && asking.note !== null) report.notes.push(asking.note);
    }
    printReport(
      {
        changes,
        info: [...warp.info, ...planned.info, ...report.info],
        notes: [...report.notes, ...wouldRegister.notes, ...planned.notes],
      },
      "Nothing to change.",
    );
    console.log("Dry run: nothing was written or run.");
    return 0;
  }

  // Every question before anything runs. A "no" to one leaves the others as answered;
  // only what depends on it goes (Warp's plugin and shortcuts go with Warp's commands).
  if (autoMode !== null) managed.autoMode = askAutoMode(paths, options, autoMode, report.notes);
  const declined = askStatusline(paths, machine, managed);
  let warpYes = true;
  if (warp.commands.length > 0) {
    const what = options.removeWarp
      ? "To remove Warp, cc-smart-dev-kit runs these commands (sudo asks for your password)"
      : "To install Warp from its signed source, cc-smart-dev-kit runs these commands (sudo asks for your password)";
    const rerun = options.removeWarp
      ? "cc-smart-dev-kit setup --remove-warp"
      : "cc-smart-dev-kit setup --warp";
    warpYes = askToRun(machine, what, warp.commands, rerun, report.notes);
  }

  let warpDone = warpYes;
  if (warp.commands.length > 0 && warpYes) {
    try {
      if (warp.stage) await stageWarpFiles(machine, detectSystem(machine), paths);
      const undo = options.removeWarp ? null : "cc-smart-dev-kit setup --remove-warp";
      warpDone = runOnTerminal(machine, warp.commands, undo, report.notes);
    } catch (error) {
      report.notes.push(`! ${messageOf(error)}. No Warp command was run.`);
      warpDone = false;
    } finally {
      if (warp.stage) clearWarpStage(paths);
    }
  }
  if (!warpDone) {
    ok = false;
    // Warp's plugin and shortcuts follow the app: none of them without it.
    const warpSteps = new Set(warp.pluginSteps);
    claudeSteps = claudeSteps.filter((step) => !warpSteps.has(step));
  }

  report.info.unshift(...warp.info);
  const steps = runCompanionSteps(claudeSteps, machine);
  for (const line of steps.lines) (line.startsWith("!") ? report.notes : report.changes).push(line);
  if (!steps.ok) ok = false;

  // The MCP servers, at user scope, through Claude Code's own `claude mcp` commands. An
  // update marks its record before its own `remove` runs, so a crash in between is known
  // the next time (`markMcpServerPending`).
  const applied = applyMcpServers(mcpPlan, claudeRun, machine.which, false, (name) => {
    markMcpServerPending(paths.stateDir, name);
  });
  report.changes.push(...applied.changes);
  report.notes.push(...applied.notes);
  if (!applied.ok) ok = false;

  // The first run: claude-mem came with a companion step just now, so plan it again.
  if (claudeMem === "not-installed" && claudeSteps.length > 0) {
    const again = await decideClaudeMem(paths, false, report);
    if (again !== "not-installed") managed.claudeMem = again;
  }

  const written = await withLock(
    paths.stateDir,
    () => {
      const shortcuts =
        warp.removeShortcuts && warpDone ? removeWarpDesktopEntries(paths, false) : [];
      const files = applySetup(paths, managed, false, serenaSource, machine.platform);
      // Which servers setup registered: cc-smart-dev-kit's own state, like the lock — not a
      // user file, so no backup (restore reads it to take exactly those back).
      recordApplied(paths.stateDir, applied, new Date().toISOString());
      // cc-smart-dev-kit's own state, like the lock: not a user file, so no backup.
      if (declined) atomicWrite(statuslineDeclinedFile(paths.stateDir), "no\n", 0o600);
      return { changes: [...shortcuts, ...files.changes], info: files.info, notes: files.notes };
    },
    { waitMs: 10_000 },
  );
  report.changes.push(...written.changes);
  report.info.push(...written.info);
  report.notes.push(...written.notes);

  printReport(report, "Nothing to change. Setup is up to date.");
  if (written.changes.length > 0) {
    console.log(`Done. Each changed file has a backup in ${short(paths.stateDir)}/backups/.`);
  }

  const pathDirs = (process.env.PATH ?? "").split(delimiter);
  if (!pathDirs.includes(paths.binDir)) {
    // On Windows the launchers live in `%USERPROFILE%\.local\bin`, which is not on PATH on
    // a fresh machine: the note names the folder as a Windows path and where to add it,
    // because `~` means nothing in the Environment Variables window
    // (`docs/windows-setup.md`).
    console.log(
      machine.platform === "win32"
        ? `Note: ${paths.binDir} is not on your PATH. Add it there (Windows Settings → System → About → Advanced system settings → Environment Variables → Path for your account), then open a new terminal, so the cc-smart-dev-kit command works.`
        : `Note: ${short(paths.binDir)} is not on your PATH. Add it, so the cc-smart-dev-kit command works.`,
    );
  }
  return ok ? 0 : 1;
}

/** Changes first (or `nothing`), then information, then notes. */
function printReport(report: Report, nothing: string): void {
  const lines = [
    ...(report.changes.length > 0 ? report.changes : [nothing]),
    ...report.info,
    ...report.notes,
  ];
  console.log(lines.join("\n"));
}
