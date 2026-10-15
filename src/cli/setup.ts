import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { MARKETPLACE, MARKETPLACE_ADD_COMMAND, PLUGIN_INSTALL_COMMAND } from "../build-info";
import {
  ALWAYS_ON_FILE,
  type InstructionsPaths,
  installInstructions,
  removeInstructions,
} from "../setup/instructions";
import { installLauncher } from "../setup/launcher";
import { withLock } from "../setup/lock";
import { applyManagedJson, formatKeyPath, type KeyPath } from "../setup/managed-json";
import { type CliPaths, tildify } from "./paths";

/** The key that turns on auto-update for the anymodel marketplace. Claude Code's install leaves it out. */
export const AUTO_UPDATE_KEY: KeyPath = ["extraKnownMarketplaces", MARKETPLACE, "autoUpdate"];

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

export interface SetupOptions {
  dryRun: boolean;
  /** false: `--no-instructions` — leave the instructions out, and take them out if present. */
  instructions: boolean;
  /** The plugin's `instructions` folder, beside `dist/`. */
  instructionsSource: string;
}

/** Where the instructions go, and how the CLAUDE.md block names them. */
export function instructionsPaths(paths: CliPaths, source: string): InstructionsPaths {
  const target = join(paths.stateDir, "instructions");
  return {
    source,
    target,
    // Not a field of cliPaths: that module is in the router bundle, and a changed router
    // bundle makes every machine restart its router.
    claudeMd: join(paths.claudeConfigDir, "CLAUDE.md"),
    stateDir: paths.stateDir,
    // `~/...` keeps a CLAUDE.md shared between machines (a dotfiles repo) right on each one.
    importPath: tildify(join(target, ALWAYS_ON_FILE), paths.home),
  };
}

/** Every change setup makes, in order. With `dryRun`, it only reports them. */
function applySetup(paths: CliPaths, options: SetupOptions, dryRun: boolean): string[] {
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

  const where = instructionsPaths(paths, options.instructionsSource);
  const instructions = options.instructions
    ? installInstructions(where, dryRun)
    : removeInstructions(where, dryRun);
  for (const line of instructions) {
    lines.push(`${line.mark} ${short(line.file)}: ${line.what}`);
  }
  return lines;
}

export async function runSetup(paths: CliPaths, options: SetupOptions): Promise<number> {
  const short = (path: string) => tildify(path, paths.home);

  if (!marketplaceKnown(paths.settingsFile)) {
    console.error(
      `${short(paths.settingsFile)} does not list the ${MARKETPLACE} marketplace yet.\n` +
        `Run first: ${MARKETPLACE_ADD_COMMAND}\n` +
        `Then:      ${PLUGIN_INSTALL_COMMAND}`,
    );
    return 1;
  }

  // A read-only pass first: a key the user set (autoUpdate: false) throws ForeignKeyError
  // here, before anything is written, the launcher and the state folder included.
  const planned = applySetup(paths, options, true);

  if (options.dryRun) {
    // Nothing at all is written: no lock, no state folder.
    console.log(planned.length > 0 ? planned.join("\n") : "Nothing to change.");
    console.log("Dry run: nothing was written.");
  } else {
    const lines = await withLock(paths.stateDir, () => applySetup(paths, options, false), {
      waitMs: 10_000,
    });
    if (lines.length === 0) {
      console.log("Nothing to change. Setup is up to date.");
    } else {
      console.log(lines.join("\n"));
      console.log(`Done. Each changed file has a backup in ${short(paths.stateDir)}/backups/.`);
    }
  }

  const pathDirs = (process.env.PATH ?? "").split(delimiter);
  if (!pathDirs.includes(paths.binDir)) {
    console.log(
      `Note: ${short(paths.binDir)} is not on your PATH. Add it, so the anymodel command works.`,
    );
  }
  return 0;
}
