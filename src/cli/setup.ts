import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
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
  checkCheapTarget,
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
import { withLock } from "../setup/lock";
import { applyManagedJson, formatKeyPath, type KeyPath } from "../setup/managed-json";
import { applyTmuxLine, TMUX_LINE, TMUX_NOW_COMMAND, tmuxServerRunning } from "../setup/tmux";
import { atomicWrite } from "../setup/write";
import { type CliPaths, tildify } from "./paths";

/** The key that turns on auto-update for the anymodel marketplace. Claude Code's install leaves it out. */
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
  /** The folder whose project's `.claude/anymodel.json` gives the auto-mode entries. */
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
}

function show(value: unknown): string {
  return value === undefined ? "(none)" : JSON.stringify(value);
}

/** True when settings.json knows the anymodel marketplace (written by `claude plugin install`). */
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

  const settings = applyManagedJson({
    file: paths.settingsFile,
    stateDir: paths.stateDir,
    set: managed.statusline
      ? [
          [AUTO_UPDATE_KEY, true],
          [STATUSLINE_KEY, statuslineSetting(paths)],
        ]
      : [[AUTO_UPDATE_KEY, true]],
    dryRun,
  });
  for (const change of settings.changes) {
    changes.push(
      `~ ${short(settings.file)}: ${formatKeyPath(change.path)}: ${show(change.before)} -> ${show(change.after)}`,
    );
  }
  for (const skip of settings.skipped) {
    info.push(`  ${short(settings.file)}: ${formatKeyPath(skip.path)}: ${skip.reason}`);
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
        `  ${where}: ${JSON.stringify(entry)} is there already (not anymodel's); left alone`,
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

/**
 * The auto-mode entries this project asks for, and the change they make. Null: no
 * project, or the project cannot be read: then `notes` says why, and setup goes on
 * without them (they are only one part of setup).
 */
function planAutoMode(
  paths: CliPaths,
  options: SetupOptions,
  notes: string[],
): { wanted: AutoModeSource; added: string[]; removed: string[] } | null {
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
 * Asks about the auto-mode entries. They are trust rules, so a change is shown first,
 * then asked, always on a terminal: `--yes` skips only the question, and with no terminal
 * they are left out whatever the flags. Null: they are left out in this run.
 */
function askAutoMode(
  paths: CliPaths,
  options: SetupOptions,
  planned: { wanted: AutoModeSource; added: string[]; removed: string[] },
  notes: string[],
): AutoModeSource | null {
  const { wanted, added, removed } = planned;
  if (added.length === 0 && removed.length === 0) return wanted;
  const short = (path: string) => tildify(path, paths.home);
  const from = wanted.file ?? `${wanted.source}/.claude/anymodel.json`;
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
  if (options.machine.confirm === null) {
    notes.push(
      "! auto-mode entries left out: they are trust rules, so setup asks first, on a terminal. Run anymodel setup in a terminal.",
    );
    return null;
  }
  if (options.yes) return wanted;
  if (!options.machine.confirm("Write these auto-mode entries?")) {
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
    "Show anymodel's status line in Claude Code (plan usage, a warning from 85 %, and any gateway fallback)?",
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
  const problem = await checkCheapTarget(planned.plan.target);
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
          : `! Warp${version} was not installed by a package manager anymodel knows: remove it by hand`,
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
  const managed: Managed = {
    claudeMem: claudeMem === "not-installed" ? null : claudeMem,
    autoMode: autoMode?.wanted ?? null,
    instructions: {
      where: instructionsPaths(paths, options.instructionsSource),
      choice: options.instructions,
    },
    statusline: options.statusline,
    tmuxLine,
  };

  // A read-only pass: a key the user set (autoUpdate: false) throws ForeignKeyError here,
  // before anything is asked, written or run, the launcher and the state folder included.
  const planned = applySetup(paths, managed, true);

  if (options.dryRun) {
    const changes = [
      ...warp.commands.map((command) => `$ ${showCommand(command)}`),
      ...claudeSteps.map((step) => step.line),
      ...(warp.removeShortcuts ? removeWarpDesktopEntries(paths, true) : []),
      ...planned.changes,
    ];
    printReport(
      {
        changes,
        info: [...warp.info, ...planned.info, ...report.info],
        notes: [...report.notes, ...planned.notes],
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
      ? "To remove Warp, anymodel runs these commands (sudo asks for your password)"
      : "To install Warp from its signed source, anymodel runs these commands (sudo asks for your password)";
    const rerun = options.removeWarp ? "anymodel setup --remove-warp" : "anymodel setup --warp";
    warpYes = askToRun(machine, what, warp.commands, rerun, report.notes);
  }

  let warpDone = warpYes;
  if (warp.commands.length > 0 && warpYes) {
    try {
      if (warp.stage) await stageWarpFiles(machine, detectSystem(machine), paths);
      const undo = options.removeWarp ? null : "anymodel setup --remove-warp";
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
      const files = applySetup(paths, managed, false);
      // anymodel's own state, like the lock: not a user file, so no backup.
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
    console.log(
      `Note: ${short(paths.binDir)} is not on your PATH. Add it, so the anymodel command works.`,
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
