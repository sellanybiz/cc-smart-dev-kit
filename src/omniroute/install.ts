/**
 * Where OmniRoute is installed on this machine, and the systemd user unit that runs it.
 *
 * OmniRoute is not part of the plugin. A person installs it themselves, globally, and runs
 * it as a user service; the gateway talks to it as an ordinary backend. So nothing about one
 * machine is written here: the unit is found by looking for the user unit whose `ExecStart`
 * runs it, and the install is found from that unit's own command line — walking up from the
 * script systemd runs until a folder holds the package's manifest. With no unit, the global
 * install folders of Bun and npm are looked in, and the `omniroute` on PATH.
 *
 * Read only. Nothing here writes, restarts or installs anything.
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CliPaths } from "../cli/paths";

/** The npm package name of the router the gateway's `omniroute` backend talks to. */
export const PACKAGE = "omniroute";

/** The same thing as a name in a sentence: `OmniRoute`. `PACKAGE` is for a command or a path. */
export const NAME = "OmniRoute";

/** One systemd user unit that runs a program. */
export interface UserUnit {
  /** `omniroute.service`. */
  name: string;
  /** Its file, under `~/.config/systemd/user/`. */
  file: string;
  /** The words of its `ExecStart`, quotes and backslashes undone. */
  argv: string[];
}

/** A package installed globally, and the package manager that owns it. */
export interface GlobalInstall {
  /** The package manager that put it there. */
  kind: "bun" | "npm";
  /** The folder holding the package: `…/node_modules/omniroute`. */
  folder: string;
  /** The program that updates it (the bun or npm owning that global root), or its name. */
  manager: string;
  /** The version in the package's own manifest. */
  version: string;
}

/** What was found; either side may be missing. */
export interface OmnirouteLookup {
  install: GlobalInstall | null;
  unit: UserUnit | null;
}

function tokenize(text: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: string | null = null;
  let started = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (char === "\\" && index + 1 < text.length) {
      word += text[index + 1] ?? "";
      index += 1;
      started = true;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      else word += char;
      started = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) words.push(word);
      word = "";
      started = false;
      continue;
    }
    word += char;
    started = true;
  }
  if (started) words.push(word);
  return words;
}

/**
 * The words of an `ExecStart=` line. systemd allows a leading `-` (ignore failure), a
 * `@`/`+`/`!`/`:` prefix, and a leading `{ … }` object form; the plain line is what a unit
 * written by hand holds, and the object form is read for its `argv[]=` instead.
 */
export function execStartArgv(line: string): string[] {
  const value = line.slice(line.indexOf("=") + 1).trim();
  if (value.startsWith("{")) {
    const argv = /argv\[\]=(.*?)(?:;|}$)/.exec(value)?.[1]?.trim();
    return argv === undefined ? [] : tokenize(argv);
  }
  const stripped = value.replace(/^[-@+!:]+/, "");
  return tokenize(stripped);
}

/** The `ExecStart=` words of a unit file, or null when it has none (or more than one). */
export function unitExecStart(text: string): string[] | null {
  const lines = text.split("\n").filter((line) => /^ExecStart=/.test(line.trim()));
  const first = lines[0];
  return first === undefined ? null : execStartArgv(first.trim());
}

/** True when an `ExecStart` word names a file inside the OmniRoute package. */
function namesOmniroute(word: string): boolean {
  return word.split("/").includes(PACKAGE) && /\.(mjs|cjs|js|ts)$/.test(word);
}

/** Every systemd user unit in `dir`, read; unreadable ones are skipped. */
export function userUnits(dir: string): UserUnit[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const units: UserUnit[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".service")).sort()) {
    const file = join(dir, name);
    let argv: string[] | null;
    try {
      argv = unitExecStart(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (argv !== null) units.push({ argv, file, name });
  }
  return units;
}

/** The version in a package's manifest; null when the folder is not that package's. */
function versionOf(folder: string, name: string): null | string {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
    const wanted = manifest as { name?: unknown; version?: unknown };
    if (wanted.name !== name || typeof wanted.version !== "string") return null;
    return wanted.version;
  } catch {
    return null;
  }
}

/**
 * The package folder a script belongs to: walk up from the script until a folder holds a
 * `package.json` naming this package. Null when nothing on the way does.
 */
export function packageFolderOf(script: string, name: string): null | string {
  let dir = dirname(script);
  for (let step = 0; step < 8; step += 1) {
    if (versionOf(dir, name) !== null) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/**
 * Which package manager owns a global install folder, and the program that updates it.
 *
 *   - `<prefix>/install/global/node_modules/<name>` — Bun's global folder; the bun is
 *     `<prefix>/bin/bun`.
 *   - `<prefix>/lib/node_modules/<name>` — npm's global folder; the npm is
 *     `<prefix>/bin/npm`.
 *
 * Null for any other shape: a package under a project's own `node_modules` is not a global
 * install, and updating it would change the wrong thing.
 */
export function globalRootOf(
  folder: string,
  which: (command: string) => null | string,
): { kind: "bun" | "npm"; manager: string } | null {
  const bun = /^(.*)\/install\/global\/node_modules\/[^/]+$/.exec(folder);
  if (bun !== null) {
    const prefix = bun[1] ?? "";
    const own = join(prefix, "bin", "bun");
    return { kind: "bun", manager: existsSync(own) ? own : (which("bun") ?? "bun") };
  }
  const npm = /^(.*)\/lib\/node_modules\/[^/]+$/.exec(folder);
  if (npm !== null) {
    const prefix = npm[1] ?? "";
    const own = join(prefix, "bin", "npm");
    return { kind: "npm", manager: existsSync(own) ? own : (which("npm") ?? "npm") };
  }
  return null;
}

/** The folders a global install of `name` may be in when no unit says where it is. */
function guessFolders(env: Record<string, string | undefined>, home: string): string[] {
  const bunInstall = env.BUN_INSTALL ?? join(home, ".bun");
  return [
    join(bunInstall, "install", "global", "node_modules", PACKAGE),
    join(home, ".local", "share", "bun", "install", "global", "node_modules", PACKAGE),
    join("/usr", "local", "lib", "node_modules", PACKAGE),
    join("/usr", "lib", "node_modules", PACKAGE),
  ];
}

/**
 * The folder the `omniroute` on PATH belongs to, when there is one: its link target's own
 * folder (a Bun global install links into `…/install/global/node_modules/omniroute`).
 */
function fromPath(which: (command: string) => null | string): null | string {
  const found = which(PACKAGE);
  if (found === null) return null;
  try {
    const real = realpathSync(found);
    return packageFolderOf(real, PACKAGE);
  } catch {
    return null;
  }
}

/** Where OmniRoute is installed, and the user unit that runs it. Reads; changes nothing. */
export function findOmniroute(options: {
  paths: CliPaths;
  env: Record<string, string | undefined>;
  which: (command: string) => null | string;
}): OmnirouteLookup {
  const { paths, env } = options;
  const units = userUnits(dirname(paths.routerUnitFile));
  const unit =
    units.find((entry) => entry.argv.some(namesOmniroute)) ??
    units.find((entry) => entry.argv.some((word) => word.includes(PACKAGE))) ??
    null;

  const script = unit?.argv.find(namesOmniroute) ?? null;
  const fromUnit = script === null ? null : packageFolderOf(script, PACKAGE);
  const candidates = [fromUnit, fromPath(options.which), ...guessFolders(env, paths.home)].filter(
    (folder): folder is string => folder !== null,
  );

  for (const folder of candidates) {
    const version = versionOf(folder, PACKAGE);
    if (version === null) continue;
    const root = globalRootOf(folder, options.which);
    if (root === null) continue;
    return { install: { ...root, folder, version }, unit };
  }
  return { install: null, unit };
}

/**
 * The gateway backend that talks to this OmniRoute: the one whose name is the package name,
 * else one on this machine whose port the unit mentions (`PORT=` in its own text or in an
 * `EnvironmentFile=`). Null when the config has none: `status` still works, and the update
 * skips its health check with a line saying so.
 */
export function omnirouteBackend(
  config: { backends: Record<string, { apiKey: string; baseUrl: string }> },
  unit: null | UserUnit,
  readFile: (path: string) => null | string,
): null | { apiKey: string; baseUrl: string; name: string } {
  const named = Object.entries(config.backends)
    .filter(([name]) => name === PACKAGE)
    .map(([name, backend]) => ({ ...backend, name }));
  const first = named[0];
  if (first !== undefined) return first;

  const text = unit === null ? "" : (readFile(unit.file) ?? "");
  const ports = new Set<number>();
  for (const match of text.matchAll(/(?:^|[^A-Z_])(?:PORT|OMNIROUTE_PORT)=["']?(\d{2,5})/g)) {
    ports.add(Number(match[1]));
  }
  for (const match of text.matchAll(/^EnvironmentFile=-?(.+)$/gm)) {
    const path = (match[1] ?? "").trim().replace(/^["']|["']$/g, "");
    const fromFile = readFile(path) ?? "";
    for (const port of fromFile.matchAll(/^(?:PORT|OMNIROUTE_PORT)=(\d{2,5})/gm)) {
      ports.add(Number(port[1]));
    }
  }
  for (const [name, backend] of Object.entries(config.backends).sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    let url: URL;
    try {
      url = new URL(backend.baseUrl);
    } catch {
      continue;
    }
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) continue;
    const port = url.port === "" ? 80 : Number(url.port);
    if (ports.has(port)) return { ...backend, name };
  }
  return null;
}

/** One line describing where it is, for `status` and the portal. */
export function installLine(install: GlobalInstall, home: string): string {
  const where = install.folder.startsWith(`${home}/`)
    ? `~${install.folder.slice(home.length)}`
    : install.folder;
  return `${PACKAGE} ${install.version} installed at ${where} (a global ${install.kind} install)`;
}
