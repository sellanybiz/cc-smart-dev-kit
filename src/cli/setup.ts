import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { MARKETPLACE, MARKETPLACE_ADD_COMMAND, PLUGIN_INSTALL_COMMAND } from "../build-info";
import { installLauncher, LAUNCHER_NAME } from "../setup/launcher";
import { withLock } from "../setup/lock";
import { applyManagedJson, formatKeyPath, type KeyPath } from "../setup/managed-json";
import { atomicWrite } from "../setup/write";
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

/** Every change setup makes, in order. With `dryRun`, it only reports them. */
function applySetup(paths: CliPaths, dryRun: boolean, statusline: boolean): string[] {
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
    set: statusline
      ? [
          [AUTO_UPDATE_KEY, true],
          [STATUSLINE_KEY, statuslineSetting(paths)],
        ]
      : [[AUTO_UPDATE_KEY, true]],
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
  return lines;
}

export async function runSetup(
  paths: CliPaths,
  options: {
    /** Asks the person; null without a terminal. */
    confirm?: ((question: string) => boolean) | null;
    dryRun: boolean;
    /** `--statusline`: set the status line without asking. */
    statusline?: boolean;
  },
): Promise<number> {
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
  // here, before anything is written or asked, the launcher and the state folder included.
  let statusline = options.statusline === true;
  let planned = applySetup(paths, true, statusline);

  // The status line is offered, never taken: asked only in a terminal, only when none is
  // set, and never again after a "no" (`statuslineDeclinedFile`); `--statusline` sets it
  // without asking, a "no" before or not. One someone else set stays: with `--statusline`,
  // setup then stops with ForeignKeyError and writes nothing.
  const declinedFile = statuslineDeclinedFile(paths.stateDir);
  let declined = false;
  if (
    !statusline &&
    !options.dryRun &&
    options.confirm &&
    !hasStatusline(paths.settingsFile) &&
    !existsSync(declinedFile)
  ) {
    statusline = options.confirm(
      "Show anymodel's status line in Claude Code (plan usage, a warning from 85 %, and any gateway fallback)?",
    );
    declined = !statusline;
    // The read-only pass again, with the status line it now sets.
    if (statusline) planned = applySetup(paths, true, true);
  }

  if (options.dryRun) {
    // Nothing at all is written: no lock, no state folder.
    console.log(planned.length > 0 ? planned.join("\n") : "Nothing to change.");
    console.log("Dry run: nothing was written.");
  } else {
    const lines = await withLock(
      paths.stateDir,
      () => {
        const done = applySetup(paths, false, statusline);
        // anymodel's own state, like the lock: not a user file, so no backup.
        if (declined) atomicWrite(declinedFile, "no\n", 0o600);
        return done;
      },
      { waitMs: 10_000 },
    );
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
