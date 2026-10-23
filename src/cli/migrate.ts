/**
 * `cc-smart-dev-kit migrate`: move a machine that still has the old `anymodel` names.
 *
 * Before 0.3.0 the plugin was called `anymodel`: its folders, its command, its launcher,
 * its gateway slots, its router units and its managed markers all said so. This command
 * takes a machine that ran that version to this one, and loses nothing:
 *
 *   - the folders move: `~/.config/anymodel`, the state folder (`<config folder>/anymodel`),
 *     `~/.local/share/anymodel`, `~/.local/state/anymodel`, and the launcher file;
 *   - the state folder's records (`owned.json`, `owned-entries.json`, `changed.json`) and
 *     its backups are rewritten, so `restore` still finds what the old setup changed and
 *     can still undo it;
 *   - the settings keys the old setup owned, and that still hold its value, get this
 *     version's value (the slots' names, and the words of their descriptions);
 *   - the instructions block in `~/.claude/CLAUDE.md` gets the new markers and the import
 *     path of the moved copy, and the copy is refreshed to this version's instructions;
 *   - the gateway config's slots are renamed, and an `alias` is added for each old slot
 *     name, so Claude sessions that are still running (their settings name the old slots)
 *     keep working until they restart;
 *   - the old router units are stopped and disabled (`--no-block`, as `restore` does), the
 *     new ones are installed through the gateway's own install path, and the old unit files
 *     go. Requests wait for the first drain, once;
 *   - the old plugin is uninstalled (asked on a terminal).
 *
 * The order is fixed, and nothing is written before every question is answered:
 *
 *   1. refusals (inside a Claude Code session; a Bun older than `MIN_BUN`);
 *   2. everything is read and checked — the plugin install, the folders, the gateway
 *      config (mode, and the whole rewritten config through the schema), the settings, the
 *      records, the sessions that still run the old plugin;
 *   3. every question (the router restart, the old plugin's uninstall). A "no" — or a
 *      machine with no terminal to ask on and no `--yes` — stops here, with nothing written:
 *      a machine is never left half moved because a question came too late;
 *   4. a dry run stops here, with the plan: the same steps a real run performs, computed
 *      from the old folders it would have moved;
 *   5. the moves and the rewrites, each recorded in the progress file;
 *   6. the router: the old units that exist are stopped, the old router's port is waited
 *      for, this version's units are installed, and its health page is checked;
 *   7. the closing lines: restart the sessions, test the judge again, the old plugin.
 *
 * A run that fails part way says which step failed and what is already done, and records
 * every finished step in `<stateDir>/migrate-progress.json`: running it again continues,
 * because each step is safe to repeat. It also treats a state folder that holds nothing but
 * this plugin's own bookkeeping (the sessions' records, the background update's files) as
 * one it may move into, since a Claude session's start makes it before anyone runs migrate.
 *
 * Why it refuses to run inside a Claude Code session (`CLAUDECODE`): it replaces the router
 * the session's own model traffic goes through. Run it in a terminal, and restart the
 * sessions afterwards.
 *
 * The old names live in this file, in the help line `src/entries/cli.ts` prints for it, and
 * in the page about moving (`README.md` § Moving from anymodel). Nothing else in the code
 * names them.
 */

import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { bunTooOld, COMMAND, MARKETPLACE_SOURCE, PLUGIN_ID, VERSION } from "../build-info";
import { ConfigError, DEFAULT_PORT, messageOf, parseConfig, saveConfig } from "../gateway/config";
import { type HealthProbe, waitWhileRouterAnswers } from "../gateway/health";
import {
  installRouter,
  type Runner,
  stopUnits,
  systemdService,
  type UnitStop,
  unitActive,
} from "../gateway/service";
import { gatewayEnv } from "../gateway/settings";
import { ASK_LOG_FILE } from "../hooks/ask-log";
import { hostPlatform } from "../machine/host";
import { isInside } from "../path-compare";
import { isOwnerOnly } from "../setup/file-mode";
import { findUserInstall, type PluginInstall } from "../setup/installed-plugins";
import {
  copyInstalled,
  type InstructionsLine,
  type InstructionsPaths,
  installInstructions,
  instructionsOptedOut,
  instructionsPaths,
} from "../setup/instructions";
import { installLauncher, LAUNCHER_NAME } from "../setup/launcher";
import { withLock } from "../setup/lock";
import { ownedEntries } from "../setup/managed-entries";
import { applyManagedJson, getKey, isObject, ownedRecords, ownership } from "../setup/managed-json";
import { BLOCK_BEGIN, BLOCK_END } from "../setup/managed-markdown";
import {
  atomicWrite,
  BACKUP_INFIX,
  backupDir,
  backupFile,
  readChanged,
  realTarget,
  writeManagedFile,
} from "../setup/write";
import { runningSessions, type SessionRecord, updateFiles } from "../update/state";
import { type CliPaths, tildify } from "./paths";
import { dryRunEnding } from "./ui/out";

/** The last line of `migrate --dry-run`: it can also stop the router. */
const MIGRATE_DRY_RUN = dryRunEnding(["written", "run", "stopped"]);

/**
 * The old names, in one place. This file, its test, and the README's "Moving from
 * anymodel" section are the only places they stay: everything else says
 * `cc-smart-dev-kit`.
 */
export const OLD = {
  /** The plugin and marketplace name: the name of its folders and of its command. */
  name: "anymodel",
  /** `anymodel@anymodel`: the id `claude plugin uninstall` takes. */
  pluginId: "anymodel@anymodel",
  /** Its marketplace. */
  marketplace: "anymodel",
  /** The router's systemd user units. */
  unit: "anymodel-router.service",
  socket: "anymodel-router.socket",
  /** The router's health page: the old router answers no other path. */
  healthPath: "/__anymodel/health",
  /** The instructions block's markers in `~/.claude/CLAUDE.md`. */
  blockBegin: "<!-- anymodel:begin -->",
  blockEnd: "<!-- anymodel:end -->",
  /** The middle of a backup's file name: `<name>.bak-anymodel-<stamp>`. */
  backupInfix: ".bak-anymodel-",
} as const;

/**
 * The gateway env keys the old version wrote, with the value it wrote
 * (`anymodel-scout[1m]`, `Scout (cheap)`, …). Migrate's own table: it is what an old
 * machine's settings hold, and it must not follow this version's names.
 */
export function oldGatewayEnv(port: number): Record<string, string> {
  return {
    ENABLE_TOOL_SEARCH: "true",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "anymodel-scout[1m]",
    ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION:
      "Cheap model for search and reading: the scout slot (anymodel gateway slot scout …)",
    ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: "Scout (cheap)",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "anymodel-worker[1m]",
    ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION:
      "Cheap model for routine code and docs: the worker slot (anymodel gateway slot worker …)",
    ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Worker (cheap)",
  };
}

/**
 * The router units a move replaces, and the folder their files live in. One table, so a
 * live check (or a test) can point a whole run at throwaway runtime units — the old and the
 * new names change together, and nothing of a real machine's router is touched.
 */
export interface MigrateUnits {
  /** The folder both pairs of unit files live in: `~/.config/systemd/user`. */
  dir: string;
  /** The old service unit's file name (0.2.x: `<name>-router.service`). */
  oldUnit: string;
  /** The old socket unit's file name; a 0.2.x machine never had one. */
  oldSocket: string;
  /** This version's service unit. */
  unit: string;
  /** This version's socket unit. */
  socket: string;
}

export function migrateUnits(paths: CliPaths, overrides: Partial<MigrateUnits> = {}): MigrateUnits {
  return {
    dir: overrides.dir ?? dirname(paths.routerUnitFile),
    oldUnit: overrides.oldUnit ?? OLD.unit,
    oldSocket: overrides.oldSocket ?? OLD.socket,
    unit: overrides.unit ?? basename(paths.routerUnitFile),
    socket: overrides.socket ?? basename(paths.routerSocketFile),
  };
}

/** Every path a machine on the old names has, beside the ones `cliPaths()` knows. */
export interface MigratePaths {
  /** `~/.config/anymodel` → `~/.config/cc-smart-dev-kit`. */
  oldConfigDir: string;
  /** `~/.config/cc-smart-dev-kit`, the gateway config's folder. */
  configDir: string;
  /** `<config folder>/anymodel` → `<config folder>/cc-smart-dev-kit`, the state folder. */
  oldStateDir: string;
  stateDir: string;
  /** `~/.local/share/anymodel` → `~/.local/share/cc-smart-dev-kit`. */
  oldShareDir: string;
  /** `~/.local/share/cc-smart-dev-kit`. */
  shareDir: string;
  /** `~/.local/state/anymodel` → `~/.local/state/cc-smart-dev-kit`. */
  oldStateHomeDir: string;
  /** `~/.local/state/cc-smart-dev-kit`. */
  stateHomeDir: string;
  /** `~/.local/bin/anymodel` → `~/.local/bin/cc-smart-dev-kit`. */
  oldLauncher: string;
  launcher: string;
  /** The old router's unit files, beside this version's. */
  oldUnitFile: string;
  oldSocketFile: string;
  /** This version's unit files, named by the units table. */
  unitFile: string;
  socketFile: string;
}

/** The old paths, from HOME and CLAUDE_CONFIG_DIR, so a test points them anywhere. */
export function migratePaths(paths: CliPaths, units: MigrateUnits): MigratePaths {
  return {
    oldConfigDir: join(paths.home, ".config", OLD.name),
    configDir: join(paths.home, ".config", COMMAND),
    oldStateDir: join(paths.claudeConfigDir, OLD.name),
    stateDir: paths.stateDir,
    oldShareDir: join(paths.home, ".local", "share", OLD.name),
    shareDir: join(paths.home, ".local", "share", COMMAND),
    oldStateHomeDir: join(paths.home, ".local", "state", OLD.name),
    stateHomeDir: join(paths.home, ".local", "state", COMMAND),
    oldLauncher: join(paths.binDir, OLD.name),
    launcher: join(paths.binDir, LAUNCHER_NAME),
    oldUnitFile: join(units.dir, units.oldUnit),
    oldSocketFile: join(units.dir, units.oldSocket),
    unitFile: join(units.dir, units.unit),
    socketFile: join(units.dir, units.socket),
  };
}

/** One old path and what it becomes: `<what>` says it for a line of output. */
interface MovedPath {
  from: string;
  to: string;
  what: string;
}

/** The folders a move takes to their new names, each with what it holds. */
function movedFolders(old: MigratePaths): MovedPath[] {
  return [
    {
      from: old.oldConfigDir,
      to: old.configDir,
      what: "the gateway config, and the machine's job settings",
    },
    { from: old.oldStateDir, to: old.stateDir, what: "the state folder: records and backups" },
    {
      from: old.oldShareDir,
      to: old.shareDir,
      what: "the router's copy, and the heavy jobs' state",
    },
    { from: old.oldStateHomeDir, to: old.stateHomeDir, what: "the router's limit state" },
  ];
}

/** The file a move takes to its new name: the launcher. */
function movedFile(old: MigratePaths): MovedPath {
  return { from: old.oldLauncher, to: old.launcher, what: "the launcher" };
}

/**
 * Every path a move renames in the records: the folders and the launcher it moves, and the
 * two unit files (their records must name this version's units, which replace them — the
 * files themselves are removed once the new ones are installed). Nothing else is renamed: a
 * folder of the person's own that happens to carry the old word in its name is not ours.
 */
function renamedPairs(old: MigratePaths): { from: string; to: string }[] {
  return [
    ...movedFolders(old).map(({ from, to }) => ({ from, to })),
    { from: old.oldLauncher, to: old.launcher },
    { from: old.oldUnitFile, to: old.unitFile },
    { from: old.oldSocketFile, to: old.socketFile },
  ];
}

/**
 * How a move spells the old paths and names: the folders and files that move, the units
 * that replace the old ones, and the old slot names. One object, so the state folder's
 * records, the gateway config and the limit state are all respelled the same way.
 */
export interface Renamer {
  /** The file a record names, under a folder that moved (`<stateDir>/instructions/core.md`). */
  path(file: string): string;
  /** A backup file's name, which carries the old infix and may carry an old name. */
  backupName(name: string): string;
  /** An old slot name (`anymodel-opus` → `cc-smart-dev-kit-opus`). A model or a target stays. */
  slot(name: string): string;
}

export function makeRenamer(old: MigratePaths, units: MigrateUnits): Renamer {
  const pairs = renamedPairs(old);
  return {
    path(file) {
      for (const { from, to } of pairs) {
        // `isInside`, not a `${from}/` prefix: on Windows the records' paths have `\`. A
        // record holds a real path, written the way `from` is, so the part after it is the
        // same length in both.
        if (isInside(file, from)) return to + file.slice(from.length);
      }
      return file;
    },
    backupName(name) {
      // Both parts of `<file's name>.bak-anymodel-<stamp>` may carry the old name — a backup
      // of the launcher is `anymodel.bak-anymodel-…`, of a unit
      // `anymodel-router.service.bak-anymodel-…` — and `listBackups` looks a name up by the
      // file it belongs to, so both say the new name.
      const at = name.indexOf(OLD.backupInfix);
      if (at === -1) return name;
      const base = name.slice(0, at);
      const rest = name.slice(at + OLD.backupInfix.length);
      const renamed =
        base === OLD.name
          ? COMMAND
          : base === units.oldUnit
            ? units.unit
            : base === units.oldSocket
              ? units.socket
              : base;
      return `${renamed}${BACKUP_INFIX}${rest}`;
    },
    slot(name) {
      if (name === OLD.name) return COMMAND;
      if (name.startsWith(`${OLD.name}-`)) return `${COMMAND}${name.slice(OLD.name.length)}`;
      return name;
    },
  };
}

/** One line of a run's output: `<mark> <path>: <what>`, or information without a path. */
export function say(mark: "+" | "-" | "~" | "!" | " ", path: string | null, what: string): void {
  if (path === null) console.log(`${mark === " " ? "  " : `${mark} `}${what}`);
  else console.log(`${mark} ${path}: ${what}`);
}

export interface MigrateOptions {
  dryRun: boolean;
  /** `--yes`: no question. The old plugin is uninstalled only on a terminal. */
  yes: boolean;
  /** The bun running this command: what the new launcher bakes. */
  bunPath: string;
  bunVersion: string;
  /** This version's `dist/router.js`. */
  bundle: string;
  /** The plugin's instructions folder (`plugin/instructions`). */
  instructionsSource: string;
  runner: Runner;
  /** False where there is no systemd (macOS, Windows): the units are left to `gateway setup`. */
  systemd: boolean;
  /** Asks the person; null when there is no terminal. */
  confirm: ((question: string) => boolean) | null;
  /** Asks the router's port after the stop, until it is closed; a test passes a fake. */
  probe: HealthProbe;
  /** This process's environment: `CLAUDECODE` refuses the run. */
  env: Record<string, string | undefined>;
  /**
   * The units and the port this run works on (a live check or a test points them at
   * throwaway runtime units and a free port). Default: this machine's own router.
   */
  router?: { units?: Partial<MigrateUnits>; port?: number };
  /** Tests only: runs after a step is recorded, to play a failure there. */
  onStepDone?: (step: MigrateStep) => void;
}

/** The commands that install this plugin; said when it is not installed yet. */
export function installCommands(): string[] {
  return [
    `claude plugin marketplace add ${MARKETPLACE_SOURCE}`,
    `claude plugin install ${PLUGIN_ID}`,
  ];
}

/**
 * The steps of a move, in order. Each one is safe to repeat: a run that stopped part way
 * records the steps it finished in `<stateDir>/migrate-progress.json`, and the next run
 * skips them.
 */
export const MIGRATE_STEPS = [
  "folders",
  "records",
  "gateway-config",
  "limit-state",
  "settings",
  "instructions",
  "launcher",
  "router",
  "old-plugin",
] as const;

export type MigrateStep = (typeof MIGRATE_STEPS)[number];

/** What a run has finished: `<stateDir>/migrate-progress.json`. */
export interface MigrateProgress {
  /** When the run started, ISO 8601 in UTC. */
  at: string;
  steps: MigrateStep[];
}

export function progressFile(stateDir: string): string {
  return join(stateDir, "migrate-progress.json");
}

/** The progress a run left here, or null when there is none (or it cannot be read). */
export function readProgress(stateDir: string): MigrateProgress | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(progressFile(stateDir), "utf8"));
    if (!isObject(parsed) || !Array.isArray(parsed.steps)) return null;
    const steps = parsed.steps.filter((step): step is MigrateStep =>
      (MIGRATE_STEPS as readonly string[]).includes(String(step)),
    );
    return { at: typeof parsed.at === "string" ? parsed.at : "", steps };
  } catch {
    return null;
  }
}

function writeProgress(stateDir: string, progress: MigrateProgress): void {
  atomicWrite(progressFile(stateDir), `${JSON.stringify(progress, null, 2)}\n`, 0o600);
}

/**
 * The names this plugin's own hooks and background update write without anyone running a
 * command. A state folder that holds nothing else was made by a Claude session's start (its
 * `sessions/` record, an update check) before migrate ran, so a move goes into it instead of
 * refusing; anything else in it is a setup of this version's, and two folders are never
 * merged by themselves.
 */
export const BOOKKEEPING_NAMES: readonly string[] = [
  "agent-launches.jsonl",
  // The guards' record of what they asked (`src/hooks/ask-log.ts`): a hook writes it.
  ASK_LOG_FILE,
  "lock",
  "migrate-progress.json",
  "notify.json",
  // Every file and folder of the self-update (`sessions/`, `update-major.json`, …), from the
  // one list of them, so a new one is never taken for a setup of this version's.
  ...Object.values(updateFiles("")).map((path) => basename(path)),
];

/** The new state folder's entries that are not this plugin's own bookkeeping. */
export function foreignStateEntries(old: MigratePaths): string[] {
  if (!existsSync(old.stateDir)) return [];
  return readdirSync(old.stateDir).filter((name) => !BOOKKEEPING_NAMES.includes(name));
}

/** Is there anything of the old names on this machine, in a file or in a folder? */
export function oldPiecesPresent(paths: CliPaths, old: MigratePaths, renamer: Renamer): boolean {
  if (
    [
      old.oldConfigDir,
      old.oldStateDir,
      old.oldShareDir,
      old.oldStateHomeDir,
      old.oldLauncher,
      old.oldUnitFile,
      old.oldSocketFile,
    ].some((path) => existsSync(path))
  ) {
    return true;
  }
  // A run that stopped part way leaves its progress record, and each of its steps may have
  // left the old names in a file whose folder has already moved: all of them count.
  if (readProgress(old.stateDir) !== null) return true;
  const configFile = existsSync(paths.gatewayConfigFile)
    ? paths.gatewayConfigFile
    : join(old.oldConfigDir, "gateway.json");
  if (oldNamesInConfig(configFile, renamer)) return true;
  const claudeMd = join(paths.claudeConfigDir, "CLAUDE.md");
  if (readText(claudeMd)?.includes(OLD.blockBegin) === true) return true;
  return recordsNameOldPaths(oldStateFolder(old), renamer);
}

/** The state folder that holds the records now: the old one while it is there, else the new. */
export function oldStateFolder(old: MigratePaths): string {
  return existsSync(old.oldStateDir) ? old.oldStateDir : old.stateDir;
}

/** A file's text, or null when it cannot be read (a check must never fail on that). */
function readText(file: string): null | string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Does the gateway config still name an old slot (a slot key, a model slot, an alias value)? */
function oldNamesInConfig(file: string, renamer: Renamer): boolean {
  const text = readText(file);
  if (text === null) return false;
  try {
    const raw: unknown = JSON.parse(text);
    if (!isObject(raw)) return false;
    const slots = isObject(raw.slots) ? Object.keys(raw.slots) : [];
    const modelSlots = isObject(raw.modelSlots) ? Object.values(raw.modelSlots) : [];
    // An alias's own name stays as it is on purpose (`anymodel-scout` → a slot): only the
    // slot it points at is renamed.
    const aliases = isObject(raw.aliases) ? Object.values(raw.aliases) : [];
    return [...slots, ...modelSlots, ...aliases].some(
      (name) => typeof name === "string" && renamer.slot(name) !== name,
    );
  } catch {
    return false;
  }
}

/** Do the records still name paths under a folder that moved? */
function recordsNameOldPaths(stateDir: string, renamer: Renamer): boolean {
  for (const name of ["owned.json", "owned-entries.json", "changed.json"]) {
    const text = readText(join(stateDir, name));
    if (text === null) continue;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isObject(parsed)) continue;
      const keys = name === "changed.json" && isObject(parsed.files) ? parsed.files : parsed;
      if (!isObject(keys)) continue;
      if (Object.keys(keys).some((file) => renamer.path(file) !== file)) return true;
    } catch {
      // A broken record file is the pre-check's to report, not this one's.
    }
  }
  const backups = join(stateDir, "backups");
  if (existsSync(backups)) {
    for (const folder of readdirSync(backups)) {
      if (renamer.path(decodeURIComponent(folder)) !== decodeURIComponent(folder)) return true;
    }
  }
  return false;
}

/**
 * Stops before anything is written when a target is already there: two folders are never
 * merged silently, and a newer folder of this version is never overwritten. The one
 * exception is this version's own state folder holding nothing but bookkeeping
 * (`foreignStateEntries`): a Claude session makes it before anyone runs migrate, and the
 * move goes into it (`absorbStateFolder`). Anything else in it stops the run, and the line
 * names what each folder holds.
 */
export function blockedTargets(old: MigratePaths): string[] {
  const blocked: string[] = [];
  for (const { from, to } of movedFolders(old)) {
    if (!existsSync(from) || !existsSync(to)) continue;
    if (to === old.stateDir && foreignStateEntries(old).length === 0) continue;
    const foreign = to === old.stateDir ? foreignStateEntries(old) : null;
    blocked.push(
      foreign === null || foreign.length === 0
        ? `${to} is already there: ${from} cannot be moved onto it, and two folders are never merged by themselves. Move or remove one of them by hand, then run again.`
        : `${to} is already there, and it holds ${foreign.join(", ")}: it is this version's own state folder. ${from} holds the old setup's files, which this move brings in, so move or remove ${to} by hand (its own files are the ones to look at first), then run again.`,
    );
  }
  if (existsSync(old.oldLauncher) && existsSync(old.launcher)) {
    blocked.push(
      `${old.launcher} is already there: ${old.oldLauncher} cannot be moved onto it. Remove the old launcher by hand, then run again.`,
    );
  }
  return blocked;
}

/** Moves one folder or file, keeping its modes. False when there is nothing to move. */
function move(from: string, to: string, dryRun: boolean): boolean {
  if (!existsSync(from)) return false;
  if (!dryRun) renameSync(from, to);
  return true;
}

/**
 * Moves every entry of the old state folder into this version's (which is already there),
 * and answers how many moved. A name both folders hold keeps the one that is already in the
 * target — it is this version's, and the newer state of the two — and a folder both hold
 * (`sessions/`) has the two merged; the old setup's records are never a name the target
 * holds, because a target that holds anything else is refused before anything moves.
 */
function absorbStateFolder(from: string, to: string, dryRun: boolean): number {
  if (!existsSync(from)) return 0;
  let moved = 0;
  for (const name of readdirSync(from)) {
    const source = join(from, name);
    const target = join(to, name);
    if (!existsSync(target)) {
      moved += 1;
      if (!dryRun) renameSync(source, target);
      continue;
    }
    if (statSync(source).isDirectory() && statSync(target).isDirectory()) {
      moved += absorbStateFolder(source, target, dryRun);
      if (!dryRun) rmSync(source, { recursive: true, force: true });
      continue;
    }
    // Both hold it: this version's file is the one that stays (the old one is the old
    // version's, and this name is this run's own lock or its bookkeeping).
    if (!dryRun) rmSync(source, { recursive: true, force: true });
  }
  if (!dryRun && readdirSync(from).length === 0) rmSync(from, { recursive: true, force: true });
  return moved;
}

/**
 * The state folder's records, rewritten so `restore` keeps working:
 *
 * - `owned.json` and `owned-entries.json`: the file paths in their keys;
 * - `changed.json`: its file paths, and each entry's `baseline` (a path inside the state
 *   folder, which itself moved);
 * - `backups/`: each folder is named from the file's real path, so a folder whose file
 *   moved is renamed too; each backup file's name carries the infix, so it gets the new
 *   one. The folder name is `encodeURIComponent(realPath)`: it is decoded, renamed and
 *   encoded again.
 *
 * The values stay as they are: an `owned.json` record keeps the value the old version
 * wrote, and exactly that tells a key the person changed since from a key that still holds
 * ours. Rewriting twice changes nothing (a run after a partly finished one).
 */
export function rewriteStateFolder(
  stateDir: string,
  renamer: Renamer,
  dryRun: boolean,
): { files: number; backups: number } {
  let files = 0;
  let backups = 0;
  const rewriteJson = (name: string, rewrite: (parsed: unknown) => unknown): void => {
    const file = join(stateDir, name);
    if (!existsSync(file)) return;
    const text = readFileSync(file, "utf8");
    const next = `${JSON.stringify(rewrite(JSON.parse(text)), null, 2)}\n`;
    if (next === text) return;
    files += 1;
    if (dryRun) return;
    // A backup first, as for every file migrate changes. The state folder has already moved,
    // so the file's real path — which names the backup's folder — is this version's already;
    // the folder loop below only renames the ones that still carry an old path.
    backupFile(stateDir, file);
    atomicWrite(file, next, 0o600);
  };

  rewriteJson("owned.json", (parsed) =>
    isObject(parsed)
      ? Object.fromEntries(
          Object.entries(parsed).map(([file, records]) => [renamer.path(file), records]),
        )
      : parsed,
  );
  rewriteJson("owned-entries.json", (parsed) =>
    isObject(parsed)
      ? Object.fromEntries(
          Object.entries(parsed).map(([file, lists]) => [renamer.path(file), lists]),
        )
      : parsed,
  );
  rewriteJson("changed.json", (parsed) => {
    const changed = (parsed as { files?: unknown } | null)?.files;
    if (!isObject(changed)) return parsed;
    return {
      ...(parsed as object),
      files: Object.fromEntries(
        Object.entries(changed).map(([file, entry]) => [
          renamer.path(file),
          isObject(entry) && typeof entry.baseline === "string"
            ? // The baseline is a backup's path, and `listBackups` builds that path from
              // the file: its folder is `encodeURIComponent(real path)` and its own name
              // carries the infix. So it is spelled the way the code spells it, from the
              // moved file and the renamed backup name.
              {
                ...entry,
                baseline: join(
                  backupDir(stateDir, renamer.path(file)),
                  renamer.backupName(basename(entry.baseline)),
                ),
              }
            : entry,
        ]),
      ),
    };
  });

  const backupsDir = join(stateDir, "backups");
  if (!existsSync(backupsDir)) return { files, backups };
  // Folders only: each holds one file's backups. Anything else in `backups/` (a file a person or
  // a tool left there) is not a backup folder, and is left as it is.
  const folders = readdirSync(backupsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const folder of folders) {
    const folderPath = join(backupsDir, folder);
    for (const name of readdirSync(folderPath)) {
      const renamed = renamer.backupName(name);
      if (renamed === name) continue;
      backups += 1;
      if (!dryRun) renameSync(join(folderPath, name), join(folderPath, renamed));
    }
    const renamedFolder = encodeURIComponent(renamer.path(decodeURIComponent(folder)));
    if (renamedFolder === folder) continue;
    backups += 1;
    if (dryRun) continue;
    const target = join(backupsDir, renamedFolder);
    if (existsSync(target)) {
      // Two paths that differ only in the old name share a folder: move the files in.
      for (const name of readdirSync(folderPath))
        renameSync(join(folderPath, name), join(target, name));
      rmSync(folderPath, { recursive: true, force: true });
    } else {
      renameSync(folderPath, target);
    }
  }
  return { files, backups };
}

/**
 * What the moved settings file needs: the gateway keys whose value is still the old one get
 * this version's, and the ones this version no longer writes (the model keys, 0.5.0) go.
 */
export function settingsChanges(
  settingsFile: string,
  stateDir: string,
  oldEnv: Record<string, string>,
  newEnv: Record<string, string>,
): { set: [string, string][]; remove: string[]; kept: string[] } {
  const set: [string, string][] = [];
  const remove: string[] = [];
  const kept: string[] = [];
  if (!existsSync(settingsFile)) return { set, remove, kept };
  const parsed: unknown = JSON.parse(readFileSync(settingsFile, "utf8"));
  const settings = isObject(parsed) ? parsed : {};
  const records = ownedRecords(stateDir, realTarget(settingsFile));
  for (const key of new Set([...Object.keys(newEnv), ...Object.keys(oldEnv)])) {
    const path = ["env", key];
    const current = getKey(settings, path);
    // The remembered-value rule: only a key that still holds what the old version wrote is
    // ours to change. A key the person changed, or removed, since is theirs.
    if (ownership(records, path, current) === "ours") {
      // A key this version no longer writes (the model keys, since 0.5.0) goes.
      if (!Object.hasOwn(newEnv, key)) {
        if (current.found) remove.push(key);
        continue;
      }
      const oldValue = oldEnv[key] ?? "";
      const newValue = newEnv[key] ?? "";
      if (oldValue !== newValue) set.push([key, newValue]);
      continue;
    }
    // Their own value stays. One that still names an old slot keeps working through the
    // alias the gateway config gains, so it is only said.
    if (current.found && typeof current.value === "string" && current.value.includes(OLD.name)) {
      kept.push(key);
    }
  }
  return { set, remove, kept };
}

/**
 * The gateway config's text as an object. Its own reader, not `loadConfigFile`: the old
 * config's slot keys fail this version's schema, which is exactly what migrate is here to
 * change. It keeps that reader's rules: a file others can read is refused, and a parse
 * error never quotes the text (it holds API keys). "Others can read" is `isOwnerOnly`'s
 * answer, so on Windows — where the mode says nothing and the profile's ACL protects the
 * file — nothing is refused.
 */
export function readOldConfig(
  file: string,
  platform: NodeJS.Platform = hostPlatform(),
): Record<string, unknown> {
  const mode = statSync(file).mode;
  if (!isOwnerOnly(mode, platform)) {
    throw new ConfigError(
      `${file} can be read by other users (mode ${(mode & 0o777).toString(8)}); it holds API keys. Run: chmod 600 ${file}`,
    );
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isObject(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new ConfigError(`${file} is not valid JSON. Fix it by hand.`);
  }
}

export interface GatewayRewrite {
  /** The raw config with this version's slot names, ready for the schema. */
  config: unknown;
  /** The slot names that changed, in the config's order. */
  slots: string[];
  /** The alias added for each of them: the old name, and the slot it now points at. */
  aliases: [string, string][];
}

/**
 * The moved gateway config with this version's slot names, and an alias for each old name:
 * a Claude session that is still running has the old name in its settings, and the router
 * resolves an alias before it routes, so its requests keep working until it restarts. An
 * alias is added only for a slot that exists — an alias to nothing would make the whole
 * config invalid. Null when there is nothing to rename.
 *
 * An alias that pointed at an old slot (`{"sab-scout": "anymodel-scout"}`, written by a
 * project's own migration) is pointed at the renamed slot too: an alias whose value is
 * another alias, or a slot that is not there, would make the whole config invalid, and the
 * config it makes is checked by the schema before anything moves.
 *
 * It works on the file's own object, never through the schema: the old slot keys are what
 * this version's schema refuses.
 */
export function rewriteGatewayConfig(
  config: Record<string, unknown>,
  renamer: Renamer,
): GatewayRewrite | null {
  const renamed: [string, string][] = [];
  const slots: Record<string, unknown> = {};
  const oldSlots = isObject(config.slots) ? config.slots : {};
  for (const [slot, targets] of Object.entries(oldSlots)) {
    const next = renamer.slot(slot);
    slots[next] = targets;
    if (next !== slot) renamed.push([slot, next]);
  }
  const aliases: Record<string, unknown> = isObject(config.aliases) ? { ...config.aliases } : {};
  for (const [name, to] of Object.entries(aliases)) {
    if (typeof to === "string" && renamer.slot(to) !== to) aliases[name] = renamer.slot(to);
  }
  for (const [oldSlot, next] of renamed) aliases[oldSlot] = next;
  const modelSlots = isObject(config.modelSlots)
    ? Object.fromEntries(
        Object.entries(config.modelSlots).map(([model, slot]) => [
          model,
          typeof slot === "string" ? renamer.slot(slot) : slot,
        ]),
      )
    : undefined;
  if (renamed.length === 0) return null;
  return {
    config: { ...config, aliases, slots, ...(modelSlots !== undefined && { modelSlots }) },
    slots: renamed.map(([slot]) => slot),
    aliases: renamed,
  };
}

/** The port the old config listens on, or the default when it names none. */
export function oldConfigPort(config: Record<string, unknown>): number {
  const port = config.port;
  return typeof port === "number" && Number.isInteger(port) ? port : DEFAULT_PORT;
}

/** The limit state's `fallbacks` keys, renamed: each is a model slot (`anymodel-opus`). */
export function rewriteLimitState(
  file: string,
  stateDir: string,
  renamer: Renamer,
  dryRun: boolean,
): number {
  if (!existsSync(file)) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return 0; // The router rewrites it; a broken file is not migrate's to fix.
  }
  if (!isObject(parsed) || !isObject(parsed.fallbacks)) return 0;
  let changed = 0;
  const fallbacks: Record<string, unknown> = {};
  for (const [slot, record] of Object.entries(parsed.fallbacks)) {
    const renamed = renamer.slot(slot);
    if (renamed !== slot) changed += 1;
    fallbacks[renamed] = record;
  }
  if (changed === 0) return 0;
  if (!dryRun) {
    const mode = statSync(file).mode & 0o7777;
    backupFile(stateDir, file);
    atomicWrite(file, `${JSON.stringify({ ...parsed, fallbacks }, null, 2)}\n`, mode);
  }
  return changed;
}

/** One line of the instructions step: a setup line, or information (`" "`). */
export interface MigrateLine {
  mark: InstructionsLine["mark"] | " ";
  file: string;
  what: string;
}

/**
 * The instructions block (markers and import path) and the managed copy of this version.
 * `stateDir` is the folder the instructions live in for this run: the old one before the
 * move (a dry run), this version's after it.
 */
export function migrateInstructions(
  paths: CliPaths,
  stateDir: string,
  options: MigrateOptions,
): MigrateLine[] {
  const lines: MigrateLine[] = [];
  const claudeMd = join(paths.claudeConfigDir, "CLAUDE.md");
  if (instructionsOptedOut(stateDir)) {
    lines.push({
      mark: " ",
      file: claudeMd,
      what: "your --no-instructions choice carries over; nothing installed",
    });
    return lines;
  }
  const text = existsSync(claudeMd) ? readFileSync(claudeMd, "utf8") : null;
  if (text === null || !text.includes(OLD.blockBegin)) return lines;
  // The markers first, so the new code finds the block; then the one path `setup` uses
  // refreshes the copy and the block's body (this version's import path and words).
  const block = text.replaceAll(OLD.blockBegin, BLOCK_BEGIN).replaceAll(OLD.blockEnd, BLOCK_END);
  const result = writeManagedFile(claudeMd, block, {
    stateDir,
    kind: "markdown-block",
    expectedContent: text,
    ...(options.dryRun && { dryRun: true }),
  });
  if (result.outcome !== "unchanged") {
    lines.push({
      mark: "~",
      file: claudeMd,
      what: "the instructions block now carries this version's markers",
    });
  }
  const instructions: InstructionsPaths = instructionsPaths(
    { ...paths, stateDir },
    options.instructionsSource,
  );
  for (const line of installInstructions(instructions, options.dryRun, VERSION)) {
    lines.push({ mark: line.mark, file: line.file, what: line.what });
  }
  return lines;
}

/** How long the move waits for the old router to let go of its port. */
export const OLD_PORT_WAIT_MS = 15_000;

/**
 * Everything a run reads before it writes anything, and what its checks found. Built once,
 * before the questions, so a failure or a question stops the machine before a single file
 * moves.
 */
export interface MigratePlan {
  /** The old plugin's install, when `installed_plugins.json` shows it (S3). */
  oldPlugin: PluginInstall | null;
  /** The gateway config the run rewrites (the old one, or this version's after a move). */
  configFile: string | null;
  /** The rewrite, through the schema, before anything moves. Null: nothing to rename. */
  rewrite: GatewayRewrite | null;
  /** The config with this version's names, checked. Null when there is no config. */
  config: unknown;
  port: number;
  /** The old router's unit is running now: the restart question is asked. */
  oldRouterActive: boolean;
  /**
   * This version's state folder is already there, holding nothing but this plugin's own
   * bookkeeping: the move goes into it (read before the run's own lock and progress files
   * are written there, so a dry run's plan says it too).
   */
  absorbState: boolean;
  /** The steps a run has already finished, from a run that stopped part way. */
  done: MigrateStep[];
  /** Claude sessions that started with the old plugin and still run (S4). */
  running: SessionRecord[];
  /** The judge targets whose test does not carry over (S5). */
  judgeTargets: string[];
}

/** The config's judge targets, whose proof does not survive the rename. */
function judgeTargets(config: Record<string, unknown> | null): string[] {
  const tested = config?.judgeTested;
  return isObject(tested) ? Object.keys(tested) : [];
}

/**
 * Reads and checks everything, and returns the first problem as one line: the new plugin's
 * install, the folders, the state folder this run may go into, the gateway config (mode, and
 * the whole rewritten config through the schema), the settings, and the records.
 */
export function readPlan(
  paths: CliPaths,
  old: MigratePaths,
  units: MigrateUnits,
  renamer: Renamer,
  options: MigrateOptions,
): { error: string } | { plan: MigratePlan } {
  const install = findUserInstall(paths.installedPluginsFile);
  if (install === null) {
    return {
      error: [
        `${PLUGIN_ID} is not installed yet, and migrate needs it: its files are what the old ones are moved into. Install it first:`,
        ...installCommands().map((command) => `  ${command}`),
      ].join("\n"),
    };
  }
  const blocked = blockedTargets(old);
  if (blocked.length > 0) return { error: blocked.join("\n") };

  // The gateway config is read here, before anything moves: its own reader refuses a file
  // others can read, its rewrite is checked against the schema, and that must stop the run
  // before the folders are moved, not after.
  const configFile = existsSync(paths.gatewayConfigFile)
    ? paths.gatewayConfigFile
    : existsSync(join(old.oldConfigDir, "gateway.json"))
      ? join(old.oldConfigDir, "gateway.json")
      : null;
  let rawConfig: Record<string, unknown> | null = null;
  if (configFile !== null) {
    try {
      rawConfig = readOldConfig(configFile);
    } catch (error) {
      return { error: messageOf(error) };
    }
  }
  const rewrite = rawConfig === null ? null : rewriteGatewayConfig(rawConfig, renamer);
  const config = rewrite === null ? rawConfig : rewrite.config;
  let port = rawConfig === null ? DEFAULT_PORT : oldConfigPort(rawConfig);
  if (config !== null) {
    const parsed = parseConfig(config);
    if ("error" in parsed) {
      return { error: `${configFile ?? ""} is not a valid gateway config:\n${parsed.error}` };
    }
    port = parsed.config.port;
  }

  // The settings and the records, parsed before anything moves: the steps that rewrite them
  // must not be the first to find out that they cannot be read.
  const stateDir = oldStateFolder(old);
  if (existsSync(paths.settingsFile)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(paths.settingsFile, "utf8"));
      if (!isObject(parsed)) {
        return {
          error: `${paths.settingsFile} must hold a JSON object. Fix it by hand, then run again.`,
        };
      }
    } catch (error) {
      return {
        error: `${paths.settingsFile} is not valid JSON (${messageOf(error)}). Fix it by hand, then run again.`,
      };
    }
  }
  try {
    ownedRecords(stateDir, realTarget(paths.settingsFile));
    ownedEntries(stateDir, realTarget(paths.settingsFile));
    readChanged(stateDir);
  } catch (error) {
    return { error: messageOf(error) };
  }

  return {
    plan: {
      absorbState: existsSync(old.stateDir) && foreignStateEntries(old).length === 0,
      config,
      configFile,
      done: readProgress(old.stateDir)?.steps ?? [],
      judgeTargets: judgeTargets(rawConfig),
      oldPlugin: findUserInstall(paths.installedPluginsFile, OLD.pluginId),
      oldRouterActive:
        options.systemd &&
        (unitActive(options.runner, units.oldUnit) ||
          (existsSync(old.oldSocketFile) && unitActive(options.runner, units.oldSocket))),
      port: options.router?.port ?? port,
      rewrite,
      running: runningSessions(updateFiles(stateDir)),
    },
  };
}

/** What the questions were answered: only a terminal yes takes the old plugin out. */
export interface MigrateAnswers {
  /** The old plugin may be uninstalled now (never from `--yes` alone). */
  uninstall: boolean;
}

/**
 * Every question, before anything is written. A "no" to the router — or no terminal to ask
 * on, without `--yes` — answers `null`: the caller stops with nothing written, because a
 * machine that moves without replacing its router is left half moved.
 */
export function askQuestions(
  units: MigrateUnits,
  options: MigrateOptions,
  plan: MigratePlan,
): MigrateAnswers | null {
  if (plan.oldRouterActive && !options.yes) {
    console.log(
      `\n${units.oldUnit} is running. This replaces it: until the new router answers, requests from running Claude sessions fail (up to 120 s; Claude Code retries them).`,
    );
    const answer = options.confirm?.(`Stop ${units.oldUnit} and start ${units.unit}?`) ?? null;
    if (answer !== true) return null;
  }
  // Only a person at a terminal takes the plugin out: `--yes` is not enough for this one,
  // and a "no" never stops the move — the closing lines name the commands.
  const uninstall =
    plan.oldPlugin !== null && options.confirm?.("Uninstall the old plugin now?") === true;
  return { uninstall };
}

/** Tells the person the old plugin is still installed, and takes it out after a terminal yes. */
export function migrateOldPlugin(options: MigrateOptions, plan: MigratePlan, yes: boolean): void {
  // Only when `installed_plugins.json` shows it installed: a machine that uninstalled it
  // already is told nothing.
  if (plan.oldPlugin === null) return;
  const commands = [
    `claude plugin uninstall ${OLD.pluginId}`,
    `claude plugin marketplace remove ${OLD.marketplace}`,
  ];
  console.log("\nThe old plugin is still installed, and its hooks would run beside these.");
  console.log("Take it out:");
  for (const command of commands) console.log(`  ${command}`);
  if (options.dryRun || !yes) return;
  for (const command of commands) {
    const result = options.runner(command.split(" "));
    const first = result.output.trim().split("\n")[0] ?? "";
    console.log(
      result.exitCode === 0
        ? `- ${command}: done`
        : `! ${command}: failed (exit ${String(result.exitCode)}): ${first}`,
    );
  }
}

/**
 * Moves a machine on the old names to this version. Every step prints one line; a dry run
 * writes, runs and stops nothing. Returns the exit code: 0 done, 1 a check failed, a
 * question was answered no, or a step failed.
 */
export async function runMigrate(paths: CliPaths, options: MigrateOptions): Promise<number> {
  const short = (path: string) => tildify(path, paths.home);
  const units = migrateUnits(paths, options.router?.units ?? {});
  const old = migratePaths(paths, units);
  const renamer = makeRenamer(old, units);

  // ─── 1. Refusals ───
  if (options.env.CLAUDECODE !== undefined) {
    console.error(
      `${COMMAND} migrate cannot run inside a Claude Code session: it replaces the router this session's own model traffic goes through. Run it in your own terminal, then restart your sessions.`,
    );
    return 1;
  }
  const tooOld = bunTooOld(options.bunVersion, tildify(options.bunPath, paths.home));
  if (tooOld !== null) {
    console.error(`${COMMAND}: ${tooOld} Upgrade this Bun, then run migrate again.`);
    return 1;
  }
  if (!oldPiecesPresent(paths, old, renamer)) {
    console.log("Nothing to move.");
    return 0;
  }

  // ─── 2. Read and check everything ───
  const read = readPlan(paths, old, units, renamer, options);
  if ("error" in read) {
    console.error(read.error);
    return 1;
  }
  const { plan } = read;
  console.log(`Moving this machine from the old ${OLD.name} names to ${COMMAND} ${VERSION}.\n`);
  for (const session of plan.running) {
    say(
      "!",
      null,
      `a Claude session that started with the old plugin is still running (pid ${String(session.pid)}, ${session.version}): close it first, and start it again here. Until then it may write the old folders again.`,
    );
  }

  // ─── 3. Every question ───
  const answers = options.dryRun ? null : askQuestions(units, options, plan);
  if (!options.dryRun && answers === null) {
    console.error(
      `Nothing was moved: ${units.oldUnit} is running, and this move replaces it. Run migrate in your own terminal, or again with --yes to replace the router without being asked.`,
    );
    return 1;
  }

  // ─── 4. The plan (a dry run stops here with it) ───
  const finished = new Set(plan.done);
  const steps = MIGRATE_STEPS.filter((step) => !finished.has(step));
  if (steps.length === 0) {
    console.log(`${COMMAND} migrate already finished on this machine; nothing is left to do.`);
    if (options.dryRun) {
      console.log(`\n${MIGRATE_DRY_RUN}`);
      return 0;
    }
    rmSync(progressFile(paths.stateDir), { force: true });
    return 0;
  }
  console.log(
    `${options.dryRun ? "A real run would do these steps" : "Steps"}: ${steps.join(", ")}.\n`,
  );
  if (options.dryRun && plan.oldRouterActive && !options.yes) {
    say(" ", null, `would ask: Stop ${units.oldUnit} and start ${units.unit}?`);
  }

  // What the records and the markers are read and written in for this run: a dry run has not
  // moved the state folder yet, so it is still the old one there — the plan a dry run prints
  // is exactly what a real run does.
  const stateDir = options.dryRun ? old.oldStateDir : old.stateDir;
  const gatewayStateFile = options.dryRun
    ? join(old.oldStateHomeDir, basename(paths.gatewayStateFile))
    : paths.gatewayStateFile;

  /** Makes the progress record, so a run that fails part way can be continued. */
  const progress: MigrateProgress = {
    at: new Date(options.probe.now()).toISOString(),
    steps: [...plan.done],
  };
  const record = (step: MigrateStep): void => {
    if (!progress.steps.includes(step)) progress.steps.push(step);
    writeProgress(paths.stateDir, progress);
    options.onStepDone?.(step);
  };

  const stepBody: Record<MigrateStep, () => void | Promise<void>> = {
    folders: () => {
      const launcher = movedFile(old);
      for (const { from, to, what } of [...movedFolders(old), launcher]) {
        // The new state folder may already be there, holding nothing but this plugin's own
        // bookkeeping (a Claude session makes it before anyone runs migrate): the move goes
        // into it instead of refusing. Anything else in it was refused before this.
        const into = to === old.stateDir && plan.absorbState;
        const absorb = to === old.stateDir && existsSync(from) && existsSync(to);
        const moved = absorb
          ? absorbStateFolder(from, to, options.dryRun)
          : Number(move(from, to, options.dryRun));
        if (moved === 0) continue;
        if (from === launcher.from) {
          say("~", short(to), `moved from ${short(from)}`);
        } else {
          say(
            "+",
            short(to),
            into
              ? `moved from ${short(from)}, into this version's own state folder (${what})`
              : `moved from ${short(from)} (${what})`,
          );
        }
      }
    },
    records: () => {
      const written = rewriteStateFolder(stateDir, renamer, options.dryRun);
      if (written.files > 0 || written.backups > 0) {
        say(
          "~",
          short(old.stateDir),
          `${String(written.files)} record file(s) and ${String(written.backups)} backup name(s) now name this version's files`,
        );
      }
    },
    "gateway-config": () => {
      if (plan.rewrite === null || plan.config === null) return;
      const parsed = parseConfig(plan.config);
      if ("error" in parsed) {
        throw new ConfigError(
          `${plan.configFile ?? ""} is not a valid gateway config:\n${parsed.error}`,
        );
      }
      say(
        "~",
        short(paths.gatewayConfigFile),
        `${String(plan.rewrite.slots.length)} slot(s) renamed, and an alias added for ${plan.rewrite.aliases.map(([name]) => name).join(", ")}, so sessions that are still running keep working`,
      );
      if (options.dryRun) return;
      backupFile(paths.stateDir, paths.gatewayConfigFile);
      saveConfig(paths.gatewayConfigFile, parsed.config);
    },
    "limit-state": () => {
      const fallbacks = rewriteLimitState(gatewayStateFile, stateDir, renamer, options.dryRun);
      if (fallbacks > 0) {
        // The path a real run changes: a dry run reads the old one, and names this one.
        say("~", short(paths.gatewayStateFile), `${String(fallbacks)} fallback record(s) renamed`);
      }
    },
    settings: () => {
      const oldEnv = oldGatewayEnv(plan.port);
      const newEnv = gatewayEnv(plan.port);
      const changes = settingsChanges(paths.settingsFile, stateDir, oldEnv, newEnv);
      if (changes.set.length > 0 || changes.remove.length > 0) {
        const result = applyManagedJson({
          file: paths.settingsFile,
          stateDir,
          set: changes.set.map(([key, value]) => [["env", key], value] as const),
          remove: changes.remove.map((key) => ["env", key]),
          ...(options.dryRun && { dryRun: true }),
        });
        if (result.changes.length > 0) {
          say(
            "~",
            short(paths.settingsFile),
            `${String(result.changes.length)} gateway key(s) changed to this version's, or taken out where it writes none`,
          );
        }
      } else if (existsSync(paths.settingsFile)) {
        say(
          " ",
          null,
          `${short(paths.settingsFile)}: no gateway key of the old setup's is left to change`,
        );
      }
      for (const key of changes.kept) {
        say(
          "!",
          null,
          `env.${key} still names an old slot, and it is not this plugin's to change (you set it, or its record is gone): it keeps working, because the router's config now has an alias for every old slot name. Write this version's name in ${short(paths.settingsFile)} when you want it.`,
        );
      }
    },
    instructions: () => {
      for (const line of migrateInstructions(paths, stateDir, options)) {
        say(line.mark, line.file, line.what);
      }
    },
    launcher: () => {
      // Nothing to write when the machine never had the old setup's launcher: creating one
      // is `setup`'s job, not this move's.
      if (!existsSync(old.oldLauncher) && !existsSync(old.launcher)) return;
      if (options.dryRun) {
        // The move brings the old launcher to the new name first, so the write finds a file
        // there: "updated", never "created".
        const outcome = existsSync(old.oldLauncher) ? "updated" : "created";
        say("~", short(old.launcher), `written for this version (${outcome})`);
        return;
      }
      const { outcome } = installLauncher(paths.binDir, {
        stateDir,
        bunPath: options.bunPath,
      });
      if (outcome !== "unchanged") {
        say("~", short(old.launcher), `written for this version (${outcome})`);
      }
    },
    router: async () => {
      // The socket first: stopped and disabled first, nothing new opens the old router
      // between the two calls. Only the units whose files are there are touched: a 0.2.x
      // machine has no socket unit, and `systemctl disable` refuses a unit that does not
      // exist, which must never stop a move.
      const existing = [
        { file: old.oldSocketFile, name: units.oldSocket },
        { file: old.oldUnitFile, name: units.oldUnit },
      ].filter((unit) => existsSync(unit.file));
      // The old units were never installed (the gateway was not set up as a service).
      if (existing.length === 0) return;
      const names = existing.map((unit) => unit.name).join(", ");
      if (options.dryRun) {
        say("~", short(old.unitFile), `would be written; ${names} stopped, disabled and removed`);
        return;
      }
      if (!options.systemd) {
        say(
          "!",
          null,
          `the old router units are there, but this machine has no systemd: remove ${existing.map((unit) => short(unit.file)).join(" and ")} by hand, then run ${COMMAND} gateway setup`,
        );
        return;
      }
      const stop: UnitStop = stopUnits(options.runner, {
        dir: units.dir,
        names: existing.map((unit) => unit.name),
      });
      for (const refused of stop.refused) {
        say(
          " ",
          null,
          `${refused.command} failed (exit ${String(refused.exitCode)}): ${refused.output.trim().split("\n")[0] ?? ""} — going on`,
        );
      }
      say(
        "-",
        names,
        plan.oldRouterActive ? "disabled and stopped" : "not running; disabled all the same",
      );
      const waited = await waitWhileRouterAnswers(
        plan.port,
        options.probe,
        OLD_PORT_WAIT_MS,
        OLD.healthPath,
      );
      if (waited.state === "held") {
        throw new Error(
          `${units.oldUnit} was told to stop, but its port 127.0.0.1:${String(plan.port)} still answers after ${String(OLD_PORT_WAIT_MS / 1000)} s. This version's router was not installed, so nothing takes the port. See why: systemctl --user status ${units.oldUnit.replace(/\.service$/, "")}, and ss -ltnp. Then run ${COMMAND} migrate again: it picks up here.`,
        );
      }
      if (waited.state === "other") {
        say(
          " ",
          null,
          `port ${String(plan.port)} answers, but not as ${OLD.name}-router (${waited.detail}); not waiting for it`,
        );
      } else {
        say(
          " ",
          null,
          `port ${String(plan.port)} is free; answers in flight finish in the background`,
        );
      }
      await installRouter({
        bunPath: options.bunPath,
        bunVersion: options.bunVersion,
        bundle: options.bundle,
        copyPath: paths.routerCopy,
        home: paths.home,
        stateDir: paths.stateDir,
        port: plan.port,
        probe: options.probe,
        runner: options.runner,
        say: (line) => console.log(`  ${line}`),
        // Always systemd: this path replaces a running 0.2.x machine's units, which only
        // exist on Linux (on Windows the step above says to remove them by hand).
        service: systemdService({ socketPath: old.socketFile, unitPath: old.unitFile }),
        yes: true,
        confirm: null,
      });
      for (const unit of existing) rmSync(unit.file, { force: true });
      say(
        "-",
        existing.map((unit) => short(unit.file)).join(", "),
        "removed (this version's units are in their place)",
      );
    },
    "old-plugin": () => {
      migrateOldPlugin(options, plan, answers?.uninstall === true);
    },
  };

  const runSteps = async (): Promise<number> => {
    for (const step of steps) {
      try {
        await stepBody[step]();
        // Recorded inside the try: a failure of the record itself is this step's failure,
        // and what it already wrote is what the next run goes on from.
        if (!options.dryRun) record(step);
      } catch (error) {
        console.error(`\n! the ${step} step failed: ${messageOf(error)}`);
        console.error(
          progress.steps.length === 0
            ? "  Nothing was changed."
            : `  Finished, and kept: ${progress.steps.join(", ")}.`,
        );
        console.error(
          `  Run ${COMMAND} migrate again: it goes on from here (every step is safe to repeat).`,
        );
        return 1;
      }
    }
    return 0;
  };

  // A dry run writes nothing, so it takes no lock and makes no state folder.
  let code: number;
  try {
    code = options.dryRun
      ? await runSteps()
      : await withLock(paths.stateDir, runSteps, { waitMs: 10_000 });
  } catch (error) {
    console.error(`${COMMAND}: ${messageOf(error)}`);
    return 1;
  }
  if (code !== 0) return code;

  // ─── 7. The closing lines: the judge, and the sessions ───
  if (plan.judgeTargets.length > 0) {
    console.log(
      `\nThe judge test does not carry over: its proof names the old command. Test the judge again: ${COMMAND} gateway slot judge ${plan.judgeTargets.join(",")}`,
    );
  }
  if (options.dryRun) {
    console.log(`\n${MIGRATE_DRY_RUN}`);
    return 0;
  }
  rmSync(progressFile(paths.stateDir), { force: true });
  console.log(
    `\nDone. Restart every running Claude session: until then they still hold the old names (the router's aliases keep them working).`,
  );
  // 0.2.x shipped no instructions, so a machine that never had the block ends the move with
  // none: only `setup` installs them (`migrateInstructions` rewrites an old block, and has
  // nothing to rewrite without one).
  if (instructionsToSetup(paths, options)) {
    console.log(
      `\nThis machine had no instructions block, so this move installed none. Run ${COMMAND} setup: it installs them, and refreshes the launcher and the companions.`,
    );
  }
  return 0;
}

/**
 * True when the machine still has no instructions after the move: no copy of them tracked
 * in the state folder, and no `--no-instructions` choice stored (that choice carries over,
 * and setup honours it). The block in `~/.claude/CLAUDE.md` is what imports the copy, and
 * it comes only with a copy.
 */
function instructionsToSetup(paths: CliPaths, options: MigrateOptions): boolean {
  if (instructionsOptedOut(paths.stateDir)) return false;
  return !copyInstalled(instructionsPaths(paths, options.instructionsSource));
}
