import { existsSync, readFileSync } from "node:fs";
import { delimiter } from "node:path";
import { MARKETPLACE, MARKETPLACE_ADD_COMMAND, PLUGIN_INSTALL_COMMAND } from "../build-info";
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
import { installLauncher } from "../setup/launcher";
import { withLock } from "../setup/lock";
import { applyManagedJson, formatKeyPath, type KeyPath } from "../setup/managed-json";
import { type CliPaths, tildify } from "./paths";

/** The key that turns on auto-update for the anymodel marketplace. Claude Code's install leaves it out. */
export const AUTO_UPDATE_KEY: KeyPath = ["extraKnownMarketplaces", MARKETPLACE, "autoUpdate"];

export interface SetupOptions {
  /** Show every change; write and run nothing. */
  dryRun: boolean;
  /** Write a project's auto-mode entries without asking (they are still shown). */
  yes: boolean;
  /** Install the Warp app (asked first, on a terminal), then its Claude plugin. */
  warp: boolean;
  /** Remove the Warp app, its package source and key, its shortcuts, and its plugin. */
  removeWarp: boolean;
  /** The folder whose project's `.claude/anymodel.json` gives the auto-mode entries. */
  project: string;
  machine: Machine;
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

/** What the managed writes cover, decided before the read-only pass. */
interface Managed {
  claudeMem: ClaudeMemPlan | null;
  autoMode: AutoModeSource | null;
}

/** Every change setup makes to files, in order. With `dryRun`, it only reports them. */
function applySetup(paths: CliPaths, managed: Managed, dryRun: boolean): string[] {
  const short = (path: string) => tildify(path, paths.home);
  const lines: string[] = [];
  const launcher = installLauncher(paths.binDir, {
    stateDir: paths.stateDir,
    bunPath: process.execPath,
    dryRun,
  });
  if (launcher.outcome !== "unchanged") {
    const mark = launcher.outcome === "created" ? "+" : "~";
    lines.push(`${mark} ${short(launcher.path)}: launcher ${launcher.outcome}`);
  }

  const settings = applyManagedJson({
    file: paths.settingsFile,
    stateDir: paths.stateDir,
    set: [[AUTO_UPDATE_KEY, true]],
    dryRun,
  });
  for (const change of settings.changes) {
    lines.push(
      `~ ${short(settings.file)}: ${formatKeyPath(change.path)}: ${show(change.before)} -> ${show(change.after)}`,
    );
  }
  for (const skip of settings.skipped) {
    lines.push(`  ${short(settings.file)}: ${formatKeyPath(skip.path)}: ${skip.reason}`);
  }

  if (managed.autoMode !== null) {
    const result = applyAutoMode(paths.settingsFile, paths.stateDir, managed.autoMode, dryRun);
    const where = `${short(result.file)}: ${formatKeyPath(AUTO_MODE_PATH)}`;
    for (const entry of result.added) lines.push(`~ ${where}: added ${JSON.stringify(entry)}`);
    for (const entry of result.removed) lines.push(`~ ${where}: removed ${JSON.stringify(entry)}`);
    for (const entry of result.skipped) {
      lines.push(
        `  ${where}: ${JSON.stringify(entry)} is there already (not anymodel's); left alone`,
      );
    }
  }

  if (managed.claudeMem !== null) {
    const result = applyClaudeMem(paths, managed.claudeMem, dryRun);
    for (const change of result.changes) {
      lines.push(
        `~ ${short(result.file)}: ${formatKeyPath(change.path)}: ${shownClaudeMemValue(change.path, change.before)} -> ${shownClaudeMemValue(change.path, change.after)}`,
      );
    }
  }
  return lines;
}

/**
 * Shows commands that change the system and asks before they run. True to run them.
 * With no terminal, or a "no", it says so, and nothing runs.
 */
function askToRun(
  machine: Machine,
  what: string,
  commands: readonly string[][],
  rerun: string,
): boolean {
  console.log(`${what}:`);
  for (const command of commands) console.log(`  $ ${showCommand(command)}`);
  if (machine.confirm === null) {
    console.log(`No terminal: nothing was run. Run \`${rerun}\` in a terminal to run them.`);
    return false;
  }
  if (!machine.confirm("Run these commands now?")) {
    console.log("Nothing was run.");
    return false;
  }
  return true;
}

/** Runs each command on the terminal, in order; stops at the first that fails. */
function runOnTerminal(machine: Machine, commands: readonly string[][]): boolean {
  for (const command of commands) {
    const code = machine.runOnTerminal(command);
    if (code !== 0) {
      console.log(`! ${showCommand(command)} failed (exit ${code}). Nothing after it ran.`);
      return false;
    }
  }
  return true;
}

/**
 * The auto-mode entries this run writes. They are trust rules, so a change is shown
 * first, then asked (unless --yes). No terminal and no --yes: they are left out.
 * Null: no change to the entries in this run.
 */
function decideAutoMode(
  paths: CliPaths,
  options: SetupOptions,
  notes: string[],
): AutoModeSource | null {
  const wanted = autoModeSource(options.project);
  if (wanted === null) return null;
  const diff = applyAutoMode(paths.settingsFile, paths.stateDir, wanted, true);
  if (diff.added.length === 0 && diff.removed.length === 0) return wanted;
  if (options.dryRun) return wanted;
  const short = (path: string) => tildify(path, paths.home);
  console.log(
    `Auto mode: trust rules from ${short(wanted.source)}/.claude/anymodel.json ("autoMode"), for ${formatKeyPath(AUTO_MODE_PATH)} in ${short(paths.settingsFile)}:`,
  );
  for (const entry of diff.added) console.log(`  + ${JSON.stringify(entry)}`);
  for (const entry of diff.removed) console.log(`  - ${JSON.stringify(entry)}`);
  if (options.yes) return wanted;
  if (options.machine.confirm === null) {
    notes.push(
      "! auto-mode entries left out: they are trust rules, so setup asks first. Run anymodel setup in a terminal, or with --yes.",
    );
    return null;
  }
  if (!options.machine.confirm("Write these auto-mode entries?")) {
    notes.push("  auto-mode entries left out (you said no)");
    return null;
  }
  return wanted;
}

/** The claude-mem keys this run writes, once the key and the model answered. Null: none. */
async function decideClaudeMem(paths: CliPaths, notes: string[]): Promise<ClaudeMemPlan | null> {
  const planned = claudeMemPlan(paths);
  if ("note" in planned) {
    if (planned.note !== null) notes.push(planned.note);
    return null;
  }
  // Nothing to change: no need to ask the backend.
  if (applyClaudeMem(paths, planned.plan, true).changes.length === 0) return planned.plan;
  const problem = await checkCheapTarget(planned.plan.target);
  if (problem !== null) {
    notes.push(`! claude-mem settings left alone: ${problem}`);
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
  lines: string[];
}

function planWarp(paths: CliPaths, options: SetupOptions): WarpWork | { error: string } {
  const machine = options.machine;
  const system = detectSystem(machine);
  const app = detectWarpApp(machine, system);
  const version = app.version === null ? "" : ` ${app.version}`;
  const none: WarpWork = {
    commands: [],
    stage: false,
    pluginSteps: [],
    removeShortcuts: false,
    lines: [],
  };
  if (options.removeWarp) {
    const commands = warpRemoveCommands(machine, system, app);
    const lines: string[] = [];
    const packageManagerRemovesIt =
      system.kind === "apt" || system.kind === "dnf" || (system.kind === "brew" && app.viaBrew);
    if (app.installed && !packageManagerRemovesIt) {
      lines.push(
        machine.platform === "darwin"
          ? "! Warp was not installed with Homebrew: move Warp.app from Applications to the Bin by hand"
          : `! Warp${version} was not installed by a package manager anymodel knows: remove it by hand`,
      );
    }
    return {
      ...none,
      commands,
      pluginSteps: warpPluginRemoveSteps(paths),
      removeShortcuts: warpDesktopEntries(paths).length > 0,
      lines,
    };
  }
  if (options.warp) {
    if (app.installed) {
      return {
        ...none,
        pluginSteps: warpPluginSteps(paths),
        lines: [`  Warp${version} is installed already`],
      };
    }
    if (system.kind === "none") return { error: system.reason };
    return {
      ...none,
      commands: warpInstallCommands(machine, system, paths),
      stage: system.kind === "apt" || system.kind === "dnf",
      pluginSteps: warpPluginSteps(paths),
    };
  }
  // Plain setup: Warp's plugin, only when the Warp app is there.
  return app.installed ? { ...none, pluginSteps: warpPluginSteps(paths) } : none;
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

  // Decide everything first: nothing is written or run before the read-only pass below.
  const notes: string[] = [];
  const warp = planWarp(paths, options);
  if ("error" in warp) {
    console.error(`Cannot install Warp here: ${warp.error}`);
    return 1;
  }
  const companions = companionPlan(paths);
  notes.push(...companions.notes);
  const claudeSteps = [...companions.steps, ...warp.pluginSteps];
  if (claudeSteps.length > 0 && machine.which("claude") === null) {
    console.error(
      "The claude command is not on PATH. Setup needs it for these steps:\n" +
        claudeSteps.map((step) => `  $ ${showCommand(step.argv)}`).join("\n"),
    );
    return 1;
  }
  const managed: Managed = {
    claudeMem: await decideClaudeMem(paths, notes),
    autoMode: decideAutoMode(paths, options, notes),
  };

  // A read-only pass: a key the user set (autoUpdate: false) throws ForeignKeyError here,
  // before anything is written or run, the launcher and the state folder included.
  const planned = applySetup(paths, managed, true);

  if (options.dryRun) {
    const lines = [
      ...warp.commands.map((command) => `$ ${showCommand(command)}`),
      ...warp.lines,
      ...claudeSteps.map((step) => step.line),
      ...(warp.removeShortcuts ? removeWarpDesktopEntries(paths, true) : []),
      ...planned,
      ...notes,
    ];
    console.log(lines.length > 0 ? lines.join("\n") : "Nothing to change.");
    console.log("Dry run: nothing was written or run.");
    return 0;
  }

  // System commands first, asked: a "no", or no terminal, stops setup before any change.
  if (warp.commands.length > 0) {
    const what = options.removeWarp
      ? "To remove Warp, anymodel runs these commands (sudo asks for your password)"
      : "To install Warp from its signed source, anymodel runs these commands (sudo asks for your password)";
    const rerun = options.removeWarp ? "anymodel setup --remove-warp" : "anymodel setup --warp";
    if (!askToRun(machine, what, warp.commands, rerun)) return 1;
    try {
      if (warp.stage) await stageWarpFiles(machine, detectSystem(machine), paths);
      if (!runOnTerminal(machine, warp.commands)) return 1;
    } catch (error) {
      console.log(`! ${messageOf(error)}. Nothing was run.`);
      return 1;
    } finally {
      if (warp.stage) clearWarpStage(paths);
    }
  }

  const lines: string[] = [...warp.lines];
  const steps = runCompanionSteps(claudeSteps, machine);
  lines.push(...steps.lines);
  const written = await withLock(
    paths.stateDir,
    () => [
      ...(warp.removeShortcuts ? removeWarpDesktopEntries(paths, false) : []),
      ...applySetup(paths, managed, false),
    ],
    { waitMs: 10_000 },
  );
  lines.push(...written);

  if (lines.length === 0 && notes.length === 0) {
    console.log("Nothing to change. Setup is up to date.");
  } else {
    if (lines.length > 0) console.log(lines.join("\n"));
    if (notes.length > 0) console.log(notes.join("\n"));
  }
  if (written.length > 0) {
    console.log(`Done. Each changed file has a backup in ${short(paths.stateDir)}/backups/.`);
  }

  const pathDirs = (process.env.PATH ?? "").split(delimiter);
  if (!pathDirs.includes(paths.binDir)) {
    console.log(
      `Note: ${short(paths.binDir)} is not on your PATH. Add it, so the anymodel command works.`,
    );
  }
  return steps.ok ? 0 : 1;
}
