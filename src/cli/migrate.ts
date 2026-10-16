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
 * Why it refuses to run inside a Claude Code session (`CLAUDECODE`): it replaces the router
 * the session's own model traffic goes through. Run it in a terminal, and restart the
 * sessions afterwards.
 *
 * The old names live in this file, in the help line `src/entries/cli.ts` prints for it, and
 * in the page about moving (`README.md` § Moving from anymodel). Nothing else in the code
 * names them.
 */

import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { COMMAND, MARKETPLACE_SOURCE, PLUGIN_ID, VERSION } from "../build-info";
import { ConfigError, DEFAULT_PORT, parseConfig, saveConfig } from "../gateway/config";
import type { HealthProbe } from "../gateway/health";
import { installRouter, type Runner, stopRouter, UNIT_NAME, unitActive } from "../gateway/service";
import { gatewayEnv } from "../gateway/settings";
import { findUserInstall } from "../setup/installed-plugins";
import {
  type InstructionsLine,
  type InstructionsPaths,
  installInstructions,
  instructionsOptedOut,
  instructionsPaths,
} from "../setup/instructions";
import { installLauncher, LAUNCHER_NAME } from "../setup/launcher";
import { withLock } from "../setup/lock";
import { applyManagedJson, getKey, isObject, ownedRecords, ownership } from "../setup/managed-json";
import { BLOCK_BEGIN, BLOCK_END } from "../setup/managed-markdown";
import {
  atomicWrite,
  BACKUP_INFIX,
  backupDir,
  backupFile,
  realTarget,
  writeManagedFile,
} from "../setup/write";
import { type CliPaths, tildify } from "./paths";

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

/** Every path a machine on the old names has, beside the ones `cliPaths()` knows. */
export interface MigratePaths {
  /** `~/.config/anymodel` → `~/.config/cc-smart-dev-kit`. */
  oldConfigDir: string;
  /** `<config folder>/anymodel` → `<config folder>/cc-smart-dev-kit`, the state folder. */
  oldStateDir: string;
  stateDir: string;
  /** `~/.local/share/anymodel` → `~/.local/share/cc-smart-dev-kit`. */
  oldShareDir: string;
  /** `~/.local/state/anymodel` → `~/.local/state/cc-smart-dev-kit`. */
  oldStateHomeDir: string;
  /** `~/.local/bin/anymodel` → `~/.local/bin/cc-smart-dev-kit`. */
  oldLauncher: string;
  launcher: string;
  /** The old router's unit files, beside this version's. */
  oldUnitFile: string;
  oldSocketFile: string;
}

/** The old paths, from HOME and CLAUDE_CONFIG_DIR, so a test points them anywhere. */
export function migratePaths(paths: CliPaths): MigratePaths {
  const systemd = join(paths.home, ".config", "systemd", "user");
  return {
    oldConfigDir: join(paths.home, ".config", OLD.name),
    oldStateDir: join(paths.claudeConfigDir, OLD.name),
    stateDir: paths.stateDir,
    oldShareDir: join(paths.home, ".local", "share", OLD.name),
    oldStateHomeDir: join(paths.home, ".local", "state", OLD.name),
    oldLauncher: join(paths.binDir, OLD.name),
    launcher: join(paths.binDir, LAUNCHER_NAME),
    oldUnitFile: join(systemd, OLD.unit),
    oldSocketFile: join(systemd, OLD.socket),
  };
}

/**
 * One path segment with the old name renamed: `anymodel` → `cc-smart-dev-kit`,
 * `anymodel-router.service` → `cc-smart-dev-kit-router.service`. A path's other segments
 * stay as they are: nothing that is not ours is renamed.
 */
function renamedSegment(segment: string): string {
  if (segment === OLD.name) return COMMAND;
  if (segment.startsWith(`${OLD.name}-`)) return `${COMMAND}${segment.slice(OLD.name.length)}`;
  return segment;
}

/** A whole path with its own segments renamed (`renamedSegment`). */
export function renamedPath(path: string): string {
  return path.split("/").map(renamedSegment).join("/");
}

/**
 * A backup's file name, renamed: `<file's name><infix><stamp>…`. Both parts may carry the
 * old name — a backup of the launcher is `anymodel.bak-anymodel-…`, of a unit
 * `anymodel-router.service.bak-anymodel-…` — and `listBackups` looks a name up by the
 * file it belongs to, so both parts must say the new name.
 */
function renamedBackupName(name: string): string {
  const at = name.indexOf(OLD.backupInfix);
  if (at === -1) return name;
  const base = name.slice(0, at);
  const rest = name.slice(at + OLD.backupInfix.length);
  return `${renamedSegment(base)}${BACKUP_INFIX}${rest}`;
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
}

/** The commands that install this plugin; said when it is not installed yet. */
export function installCommands(): string[] {
  return [
    `claude plugin marketplace add ${MARKETPLACE_SOURCE}`,
    `claude plugin install ${PLUGIN_ID}`,
  ];
}

/**
 * Is there anything of the old names on this machine? False after a run that finished:
 * a second `migrate` then says "Nothing to move.".
 */
export function oldPiecesPresent(old: MigratePaths): boolean {
  return [
    old.oldConfigDir,
    old.oldStateDir,
    old.oldShareDir,
    old.oldStateHomeDir,
    old.oldLauncher,
    old.oldUnitFile,
    old.oldSocketFile,
  ].some((path) => existsSync(path));
}

/** The folder pairs to move, each with what it holds. */
function folderPairs(
  paths: CliPaths,
  old: MigratePaths,
): { from: string; to: string; what: string }[] {
  return [
    {
      from: old.oldConfigDir,
      to: join(paths.home, ".config", COMMAND),
      what: "the gateway config, and the machine's job settings",
    },
    { from: old.oldStateDir, to: old.stateDir, what: "the state folder: records and backups" },
    {
      from: old.oldShareDir,
      to: join(paths.home, ".local", "share", COMMAND),
      what: "the router's copy, and the heavy jobs' state",
    },
    {
      from: old.oldStateHomeDir,
      to: join(paths.home, ".local", "state", COMMAND),
      what: "the router's limit state",
    },
  ];
}

/**
 * Stops before anything is written when a target is already there: two folders are never
 * merged silently, and a newer folder of this version is never overwritten.
 */
export function blockedTargets(paths: CliPaths, old: MigratePaths): string[] {
  const blocked: string[] = [];
  for (const { from, to } of folderPairs(paths, old)) {
    if (existsSync(from) && existsSync(to)) {
      blocked.push(
        `${to} is already there: ${from} cannot be moved onto it, and two folders are never merged by themselves. Move or remove one of them by hand, then run again.`,
      );
    }
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
    // A backup first, as for every file migrate changes. It is made under the file's real
    // path at this moment (the old one); the loop below renames its folder with the rest.
    backupFile(stateDir, file);
    atomicWrite(file, next, 0o600);
  };

  rewriteJson("owned.json", (parsed) =>
    isObject(parsed)
      ? Object.fromEntries(
          Object.entries(parsed).map(([file, records]) => [renamedPath(file), records]),
        )
      : parsed,
  );
  rewriteJson("owned-entries.json", (parsed) =>
    isObject(parsed)
      ? Object.fromEntries(
          Object.entries(parsed).map(([file, lists]) => [renamedPath(file), lists]),
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
          renamedPath(file),
          isObject(entry) && typeof entry.baseline === "string"
            ? // The baseline is a backup's path, and `listBackups` builds that path from
              // the file: its folder is `encodeURIComponent(real path)` and its own name
              // carries the infix. So it is spelled the way the code spells it, from the
              // moved file and the renamed backup name.
              {
                ...entry,
                baseline: join(
                  backupDir(stateDir, renamedPath(file)),
                  renamedBackupName(basename(entry.baseline)),
                ),
              }
            : entry,
        ]),
      ),
    };
  });

  const backupsDir = join(stateDir, "backups");
  if (!existsSync(backupsDir)) return { files, backups };
  for (const folder of readdirSync(backupsDir)) {
    const folderPath = join(backupsDir, folder);
    for (const name of readdirSync(folderPath)) {
      const renamed = renamedBackupName(name);
      if (renamed === name) continue;
      backups += 1;
      if (!dryRun) renameSync(join(folderPath, name), join(folderPath, renamed));
    }
    const renamedFolder = encodeURIComponent(renamedPath(decodeURIComponent(folder)));
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

/** What the moved settings file needs: the gateway keys whose value is still the old one. */
export function settingsChanges(
  settingsFile: string,
  stateDir: string,
  oldEnv: Record<string, string>,
  newEnv: Record<string, string>,
): { set: [string, string][]; kept: string[] } {
  const set: [string, string][] = [];
  const kept: string[] = [];
  if (!existsSync(settingsFile)) return { set, kept };
  const parsed: unknown = JSON.parse(readFileSync(settingsFile, "utf8"));
  const settings = isObject(parsed) ? parsed : {};
  const records = ownedRecords(stateDir, realTarget(settingsFile));
  for (const key of Object.keys(newEnv)) {
    const path = ["env", key];
    const current = getKey(settings, path);
    // The remembered-value rule: only a key that still holds what the old version wrote is
    // ours to change. A key the person changed since is theirs.
    if (ownership(records, path, current) === "ours") {
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
  return { set, kept };
}

/**
 * The gateway config's text as an object. Its own reader, not `loadConfigFile`: the old
 * config's slot keys fail this version's schema, which is exactly what migrate is here to
 * change. It keeps that reader's rules: a file others can read is refused, and a parse
 * error never quotes the text (it holds API keys).
 */
export function readOldConfig(file: string): Record<string, unknown> {
  const mode = statSync(file).mode;
  if ((mode & 0o077) !== 0) {
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
 * It works on the file's own object, never through the schema: the old slot keys are what
 * this version's schema refuses.
 */
export function rewriteGatewayConfig(config: Record<string, unknown>): GatewayRewrite | null {
  const renamed: [string, string][] = [];
  const slots: Record<string, unknown> = {};
  const oldSlots = isObject(config.slots) ? config.slots : {};
  for (const [slot, targets] of Object.entries(oldSlots)) {
    const next = renamedSegment(slot);
    slots[next] = targets;
    if (next !== slot) renamed.push([slot, next]);
  }
  const aliases: Record<string, unknown> = isObject(config.aliases) ? { ...config.aliases } : {};
  for (const [oldSlot, next] of renamed) aliases[oldSlot] = next;
  const modelSlots = isObject(config.modelSlots)
    ? Object.fromEntries(
        Object.entries(config.modelSlots).map(([model, slot]) => [
          model,
          typeof slot === "string" ? renamedSegment(slot) : slot,
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
export function rewriteLimitState(file: string, stateDir: string, dryRun: boolean): number {
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
    const renamed = renamedSegment(slot);
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

/** The instructions block (markers and import path) and the managed copy of this version. */
export function migrateInstructions(paths: CliPaths, options: MigrateOptions): MigrateLine[] {
  const lines: MigrateLine[] = [];
  const claudeMd = join(paths.claudeConfigDir, "CLAUDE.md");
  if (instructionsOptedOut(paths.stateDir)) {
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
    stateDir: paths.stateDir,
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
  const instructions: InstructionsPaths = instructionsPaths(paths, options.instructionsSource);
  for (const line of installInstructions(instructions, options.dryRun, VERSION)) {
    lines.push({ mark: line.mark, file: line.file, what: line.what });
  }
  return lines;
}

/**
 * The old router units out, this version's in. Nothing happens when the old units were
 * never installed (the gateway was not set up as a service).
 */
export async function migrateRouter(
  paths: CliPaths,
  old: MigratePaths,
  options: MigrateOptions,
  port: number,
): Promise<number> {
  const short = (path: string) => tildify(path, paths.home);
  if (!existsSync(old.oldUnitFile) && !existsSync(old.oldSocketFile)) return 0;
  if (!options.systemd) {
    say(
      "!",
      null,
      `the old router units are there, but this machine has no systemd: remove ${short(old.oldUnitFile)} and ${short(old.oldSocketFile)} by hand, then run ${COMMAND} gateway setup`,
    );
    return 0;
  }
  if (options.dryRun) {
    say(
      "~",
      short(paths.routerUnitFile),
      `would be written, and ${OLD.unit} and ${OLD.socket} stopped, disabled and removed`,
    );
    return 0;
  }
  if (
    unitActive(options.runner, basename(old.oldUnitFile)) ||
    unitActive(options.runner, basename(old.oldSocketFile))
  ) {
    console.log(
      `\n${OLD.unit} is running. This replaces it: until the new router answers, requests from running Claude sessions fail (up to 120 s; Claude Code retries them).`,
    );
    const yes = options.yes
      ? true
      : (options.confirm?.(`Stop ${OLD.unit} and start ${UNIT_NAME}?`) ?? null);
    if (yes !== true) {
      say("!", null, `the old router was left as it is. Run again with --yes to replace it`);
      return 0;
    }
  }
  const stopped = await stopRouter(options.runner, port, options.probe, {
    socket: basename(old.oldSocketFile),
    unit: basename(old.oldUnitFile),
  });
  if (stopped.kind === "other") {
    say(
      " ",
      null,
      `port ${String(port)} answers, but not as this router (${stopped.detail}); not waiting for it`,
    );
  }
  say(
    "-",
    `${OLD.unit}, ${OLD.socket}`,
    stopped.kind === "closed"
      ? `disabled and stopped (port ${String(port)} closed; answers in flight finish in the background)`
      : "disabled and stopped",
  );
  await installRouter({
    bunPath: options.bunPath,
    bunVersion: options.bunVersion,
    bundle: options.bundle,
    copyPath: paths.routerCopy,
    unitPath: paths.routerUnitFile,
    socketPath: paths.routerSocketFile,
    home: paths.home,
    stateDir: paths.stateDir,
    port,
    probe: options.probe,
    runner: options.runner,
    say: (line) => console.log(`  ${line}`),
    yes: true,
    confirm: null,
  });
  rmSync(old.oldUnitFile, { force: true });
  rmSync(old.oldSocketFile, { force: true });
  say(
    "-",
    `${short(old.oldUnitFile)}, ${short(old.oldSocketFile)}`,
    "removed (this version's units are in their place)",
  );
  return 0;
}

/** Tells the person the old plugin is still installed, and takes it out after a terminal yes. */
export function migrateOldPlugin(options: MigrateOptions): void {
  const commands = [
    `claude plugin uninstall ${OLD.pluginId}`,
    `claude plugin marketplace remove ${OLD.marketplace}`,
  ];
  console.log("\nThe old plugin is still installed, and its hooks would run beside these.");
  console.log("Take it out:");
  for (const command of commands) console.log(`  ${command}`);
  if (options.dryRun) return;
  // Only a person at a terminal takes the plugin out: `--yes` is not enough for this one.
  if (options.confirm?.("Uninstall the old plugin now?") !== true) return;
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
 * writes, runs and stops nothing. Returns the exit code: 0 done, 1 a check failed or an
 * error.
 */
export async function runMigrate(paths: CliPaths, options: MigrateOptions): Promise<number> {
  const short = (path: string) => tildify(path, paths.home);
  const old = migratePaths(paths);

  if (options.env.CLAUDECODE !== undefined) {
    console.error(
      `${COMMAND} migrate cannot run inside a Claude Code session: it replaces the router this session's own model traffic goes through. Run it in your own terminal, then restart your sessions.`,
    );
    return 1;
  }
  if (!oldPiecesPresent(old)) {
    console.log("Nothing to move.");
    return 0;
  }
  if (findUserInstall(paths.installedPluginsFile) === null) {
    console.error(
      `${PLUGIN_ID} is not installed yet, and migrate needs it: its files are what the old ones are moved into. Install it first:`,
    );
    for (const command of installCommands()) console.error(`  ${command}`);
    return 1;
  }
  const blocked = blockedTargets(paths, old);
  if (blocked.length > 0) {
    for (const line of blocked) console.error(line);
    return 1;
  }
  // The gateway config is read here, before anything moves: its own reader refuses a file
  // others can read, and that must stop the run before the folders are moved, not after.
  const configFile = existsSync(paths.gatewayConfigFile)
    ? paths.gatewayConfigFile
    : existsSync(join(old.oldConfigDir, "gateway.json"))
      ? join(old.oldConfigDir, "gateway.json")
      : null;
  const rawConfig = configFile === null ? null : readOldConfig(configFile);
  const port = rawConfig === null ? DEFAULT_PORT : oldConfigPort(rawConfig);

  console.log(`Moving this machine from the old ${OLD.name} names to ${COMMAND} ${VERSION}.\n`);

  // ─── The folders ───
  for (const { from, to, what } of folderPairs(paths, old)) {
    if (!move(from, to, options.dryRun)) continue;
    say("+", short(to), `moved from ${short(from)} (${what})`);
  }

  // ─── The state folder's records and backups ───
  // A dry run has not moved it yet: it is still at its old path there.
  const stateDirNow = options.dryRun ? old.oldStateDir : old.stateDir;
  if (existsSync(stateDirNow)) {
    const written = rewriteStateFolder(stateDirNow, options.dryRun);
    if (written.files > 0 || written.backups > 0) {
      say(
        "~",
        short(old.stateDir),
        `${String(written.files)} record file(s) and ${String(written.backups)} backup name(s) now name this version's files`,
      );
    }
  }

  // ─── The launcher ───
  if (move(old.oldLauncher, old.launcher, options.dryRun)) {
    say("~", short(old.launcher), `moved from ${short(old.oldLauncher)}`);
  }

  // ─── The gateway config: slots, and an alias for each old name ───
  if (rawConfig !== null) {
    const rewrite = rewriteGatewayConfig(rawConfig);
    if (rewrite !== null) {
      const parsed = parseConfig(rewrite.config);
      if ("error" in parsed) {
        throw new ConfigError(
          `${configFile ?? ""} is not a valid gateway config:\n${parsed.error}`,
        );
      }
      say(
        "~",
        short(paths.gatewayConfigFile),
        `${String(rewrite.slots.length)} slot(s) renamed, and an alias added for ${rewrite.aliases.map(([name]) => name).join(", ")}, so sessions that are still running keep working`,
      );
      if (!options.dryRun) {
        backupFile(paths.stateDir, paths.gatewayConfigFile);
        saveConfig(paths.gatewayConfigFile, parsed.config);
      }
    }
  }
  const fallbacks = rewriteLimitState(paths.gatewayStateFile, paths.stateDir, options.dryRun);
  if (fallbacks > 0) {
    say("~", short(paths.gatewayStateFile), `${String(fallbacks)} fallback record(s) renamed`);
  }

  // ─── The settings, the instructions and the launcher's new text ───
  const migrateFiles = async (): Promise<void> => {
    const oldEnv = oldGatewayEnv(port);
    const newEnv = gatewayEnv(port);
    const changes = settingsChanges(paths.settingsFile, paths.stateDir, oldEnv, newEnv);
    if (changes.set.length > 0) {
      const result = applyManagedJson({
        file: paths.settingsFile,
        stateDir: paths.stateDir,
        set: changes.set.map(([key, value]) => [["env", key], value] as const),
        ...(options.dryRun && { dryRun: true }),
      });
      if (result.changes.length > 0) {
        say(
          "~",
          short(paths.settingsFile),
          `${String(result.changes.length)} gateway key(s) now name this version's slots and words`,
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
    for (const line of migrateInstructions(paths, options)) {
      say(line.mark, line.file, line.what);
    }
    if (existsSync(old.launcher)) {
      const { outcome } = installLauncher(paths.binDir, {
        stateDir: paths.stateDir,
        bunPath: options.bunPath,
        ...(options.dryRun && { dryRun: true }),
      });
      if (outcome !== "unchanged") {
        say("~", short(old.launcher), `written for this version (${outcome})`);
      }
    }
  };
  // A dry run writes nothing, so it takes no lock and makes no state folder.
  if (options.dryRun) await migrateFiles();
  else await withLock(paths.stateDir, migrateFiles, { waitMs: 10_000 });

  // ─── The router units ───
  await migrateRouter(paths, old, options, port);

  // ─── The old plugin ───
  migrateOldPlugin(options);

  console.log(
    options.dryRun
      ? "\nDry run: nothing was written, run or stopped."
      : "\nDone. Restart every running Claude session: until then they still hold the old names (the router's aliases keep them working).",
  );
  return 0;
}
