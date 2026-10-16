import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CliPaths, tildify } from "../cli/paths";
import { messageOf } from "../gateway/config";
import { findUserInstall } from "../setup/installed-plugins";
import { removeManagedFile } from "../setup/write";
import { MARKETPLACE_SOURCES, marketplaceAdded, pluginEnabled } from "./companions";
import type { Machine } from "./machine";

/**
 * The Warp terminal and its Claude plugin. Opt-in: plain `setup` never installs a system
 * app or Warp's plugin. `setup --warp` installs Warp through the system's own package
 * manager, from Warp's signed source, then its Claude plugin; `setup --remove-warp` takes
 * both out again.
 *
 * Every command that needs root runs in front of the person, after they saw the exact
 * list and said yes, on their terminal: `sudo` asks for the password itself. cc-smart-dev-kit
 * never sees, stores or pipes a password, and never runs a downloaded script.
 */

export const WARP_PLUGIN_ID = "warp@claude-code-warp";
export const WARP_MARKETPLACE = "claude-code-warp";
export const WARP_DOWNLOAD_URL = "https://www.warp.dev/download";
/** Warp's signing key, as its install guide names it. */
export const WARP_KEY_URL = "https://releases.warp.dev/linux/keys/warp.asc";
/**
 * The fingerprint of Warp's signing key ("Warp Linux Maintainers (Package Signing
 * Authority)"), pinned: a downloaded key with another fingerprint is refused. Taken from
 * the key at WARP_KEY_URL (`gpg --show-keys`) and checked against the copy built into
 * Warp's own package (the postinst script of warp-terminal 0.2026.10.07.08.29.stable.00,
 * from Warp's apt repository): both give this fingerprint.
 */
export const WARP_KEY_FINGERPRINT = "0913165C78D5B7A41B42AC657FF7AB39D60F803F";
const PACKAGE = "warp-terminal";

/**
 * The key and source paths Warp's own package uses. Its postinst writes the key to
 * `<apt trustedparts>/warpdotdev.gpg` on every install and upgrade, and the source to
 * `<apt sourceparts>/warpdotdev.sources` (deb822) when neither that nor `warpdotdev.list`
 * is there; its purge removes all three. With apt's default folders those are the paths
 * below, so cc-smart-dev-kit writes the same files with the same text, and apt never sees two
 * Warp sources or two Signed-By values.
 */
export const APT_KEY = "/etc/apt/trusted.gpg.d/warpdotdev.gpg";
export const APT_SOURCE = "/etc/apt/sources.list.d/warpdotdev.sources";
/** The one-line source file an older package, or Warp's manual guide, wrote. */
export const APT_LIST = "/etc/apt/sources.list.d/warpdotdev.list";
/** The key file Warp's manual apt guide uses. */
export const APT_GUIDE_KEY = "/etc/apt/keyrings/warpdotdev.gpg";
export const YUM_REPO = "/etc/yum.repos.d/warpdotdev.repo";
const DESKTOP_ENTRY = "dev.warp.Warp.desktop";

/** The apt source, byte for byte what Warp's package writes itself (its postinst). */
export function aptSourceText(arch: AptArch): string {
  return `### THIS FILE IS AUTOMATICALLY CONFIGURED ###
# You may comment out this entry, but other modifications to the file may be lost.

Types: deb
URIs: https://releases.warp.dev/linux/deb
Suites: stable
Components: main
Architectures: ${arch}
Signed-By: ${APT_KEY}
`;
}

/**
 * The architectures Warp's apt repository has packages for, as its Packages files name
 * them: `amd64` and `arm64` (read 2026-10-16, `.../dists/stable/main/binary-<arch>/Packages`).
 * Each package's postinst writes its OWN architecture into the source line, so cc-smart-dev-kit
 * writes the one this machine runs on.
 */
export type AptArch = "amd64" | "arm64";

/** The apt architecture of this machine; null for one Warp's apt source has no packages for. */
export function aptArch(machine: Machine): AptArch | null {
  if (machine.arch === "x64") return "amd64";
  if (machine.arch === "arm64") return "arm64";
  return null;
}

/** The dnf repository, as Warp's install guide writes it. */
export const YUM_REPO_TEXT = `[warpdotdev]
name=warpdotdev
baseurl=https://releases.warp.dev/linux/rpm/stable
enabled=1
gpgcheck=1
gpgkey=${WARP_KEY_URL}
`;

/** How this system installs Warp. */
export type WarpSystem =
  | { kind: "apt"; arch: AptArch }
  | { kind: "dnf" }
  | { kind: "brew" }
  | { kind: "none"; reason: string };

/** The `ID` and `ID_LIKE` words of /etc/os-release. */
function osWords(text: string | null): string[] {
  if (text === null) return [];
  const words: string[] = [];
  for (const line of text.split("\n")) {
    const match = /^(ID|ID_LIKE)=(.*)$/.exec(line.trim());
    if (match?.[2]) words.push(...match[2].replace(/["']/g, "").toLowerCase().split(/\s+/));
  }
  return words;
}

export function detectSystem(machine: Machine): WarpSystem {
  if (machine.platform === "darwin") {
    return machine.which("brew") !== null
      ? { kind: "brew" }
      : { kind: "none", reason: `Homebrew is not installed. Download Warp: ${WARP_DOWNLOAD_URL}` };
  }
  if (machine.platform !== "linux") {
    return {
      kind: "none",
      reason: `cc-smart-dev-kit installs Warp on Linux and macOS only. Download it: ${WARP_DOWNLOAD_URL}`,
    };
  }
  const words = osWords(machine.osRelease());
  if (words.some((word) => word === "debian" || word === "ubuntu")) {
    if (machine.which("apt-get") === null || machine.which("dpkg-query") === null) {
      return { kind: "none", reason: `apt-get is missing. Download Warp: ${WARP_DOWNLOAD_URL}` };
    }
    // Warp's apt repository has x86_64 and arm64 builds (its Packages files, read 2026-10-16).
    const arch = aptArch(machine);
    if (arch === null) {
      return {
        kind: "none",
        reason: `Warp's apt source has x86_64 and arm64 builds; this machine is ${machine.arch}. Download Warp: ${WARP_DOWNLOAD_URL}`,
      };
    }
    return { kind: "apt", arch };
  }
  if (words.some((word) => ["fedora", "rhel", "centos"].includes(word))) {
    if (machine.which("dnf") === null || machine.which("rpm") === null) {
      return { kind: "none", reason: `dnf is missing. Download Warp: ${WARP_DOWNLOAD_URL}` };
    }
    // Warp's rpm repository has x86_64 and aarch64 builds (its repodata, read 2026-10-15).
    if (machine.arch !== "x64" && machine.arch !== "arm64") {
      return {
        kind: "none",
        reason: `Warp's rpm source has x86_64 and aarch64 builds; this machine is ${machine.arch}. Download Warp: ${WARP_DOWNLOAD_URL}`,
      };
    }
    return { kind: "dnf" };
  }
  return {
    kind: "none",
    reason: `cc-smart-dev-kit installs Warp with apt (Debian, Ubuntu), dnf (Fedora) or Homebrew (macOS). Download it: ${WARP_DOWNLOAD_URL}`,
  };
}

export interface WarpApp {
  installed: boolean;
  version: string | null;
  /** On macOS: installed by Homebrew (so Homebrew can remove it). */
  viaBrew?: boolean;
}

/** Is the Warp app installed, and which version? Asked of the package manager. */
export function detectWarpApp(machine: Machine, system: WarpSystem): WarpApp {
  switch (system.kind) {
    case "apt": {
      const result = machine.run(["dpkg-query", "--status", PACKAGE]);
      const field = (name: string) =>
        new RegExp(`^${name}: (.*)$`, "m").exec(result.output)?.[1]?.trim() ?? null;
      // "installed", not only known to dpkg: a package removed without purge is still known
      // ("Status: deinstall ok config-files").
      return result.exitCode === 0 && field("Status")?.endsWith(" installed") === true
        ? { installed: true, version: field("Version") }
        : { installed: false, version: null };
    }
    case "dnf": {
      const result = machine.run(["rpm", "-q", "--qf", "%{VERSION}-%{RELEASE}", PACKAGE]);
      return result.exitCode === 0
        ? { installed: true, version: result.output.trim() || null }
        : { installed: false, version: null };
    }
    case "brew": {
      const result = machine.run(["brew", "list", "--cask", "--versions", "warp"]);
      if (result.exitCode === 0 && result.output.trim() !== "") {
        return {
          installed: true,
          version: result.output.trim().split(/\s+/)[1] ?? null,
          viaBrew: true,
        };
      }
      return machine.exists(machine.macApp)
        ? { installed: true, version: null, viaBrew: false }
        : { installed: false, version: null };
    }
    case "none":
      if (machine.platform === "darwin" && machine.exists(machine.macApp)) {
        return { installed: true, version: null, viaBrew: false };
      }
      return machine.which(PACKAGE) !== null
        ? { installed: true, version: null }
        : { installed: false, version: null };
  }
}

/** Where `setup --warp` puts the files it hands to `sudo install`: cc-smart-dev-kit's own state folder. */
export function warpStageDir(paths: CliPaths): string {
  return join(paths.stateDir, "warp");
}

/** The commands that install the Warp app, in order. Empty when there is nothing to do. */
export function warpInstallCommands(
  machine: Machine,
  system: WarpSystem,
  paths: CliPaths,
): string[][] {
  const stage = warpStageDir(paths);
  const install = (from: string, to: string) => [
    "sudo",
    "install",
    "-D",
    "-o",
    "root",
    "-g",
    "root",
    "-m",
    "644",
    from,
    to,
  ];
  switch (system.kind) {
    case "apt":
      return [
        install(join(stage, "warpdotdev.gpg"), APT_KEY),
        // A Warp source that is there already (the package's own) stays as it is.
        ...(machine.exists(APT_SOURCE) || machine.exists(APT_LIST)
          ? []
          : [install(join(stage, "warpdotdev.sources"), APT_SOURCE)]),
        ["sudo", "apt-get", "update"],
        ["sudo", "apt-get", "install", "-y", PACKAGE],
      ];
    case "dnf":
      return [
        // The key downloaded and checked against the pinned fingerprint, never straight from the URL.
        ["sudo", "rpm", "--import", join(stage, "warp.asc")],
        ...(machine.exists(YUM_REPO) ? [] : [install(join(stage, "warpdotdev.repo"), YUM_REPO)]),
        ["sudo", "dnf", "install", "-y", PACKAGE],
      ];
    case "brew":
      return [["brew", "install", "--cask", "warp"]];
    case "none":
      return [];
  }
}

/**
 * The fingerprint of the one key in `file`, read with `gpg --show-keys` (it imports
 * nothing; its home folder is a fresh one in the stage, never the person's). Throws when
 * the file holds no key, or more than one: every key in it would be trusted.
 */
function keyFingerprint(machine: Machine, stage: string, file: string): string {
  const home = join(stage, "gnupg");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const shown = machine.run([
    "gpg",
    "--homedir",
    home,
    "--batch",
    "--show-keys",
    "--with-colons",
    file,
  ]);
  if (shown.exitCode !== 0) {
    throw new Error(`gpg could not read Warp's key: ${shown.output.trim()}`);
  }
  const lines = shown.output.split("\n");
  const primaries = lines.flatMap((line, index) => (line.startsWith("pub:") ? [index] : []));
  if (primaries.length !== 1) {
    throw new Error(
      `the file at ${WARP_KEY_URL} holds ${primaries.length} keys, not Warp's one key. Nothing was installed`,
    );
  }
  const fpr = lines[(primaries[0] ?? 0) + 1] ?? "";
  return fpr.startsWith("fpr:") ? (fpr.split(":")[9] ?? "").toUpperCase() : "";
}

/**
 * Makes the files the install commands use: Warp's key, downloaded over HTTPS and
 * checked against the pinned fingerprint, then (apt) turned into the binary form apt
 * reads (`gpg --dearmor`); and the source or repository file. Runs only right before the
 * commands, after the person said yes.
 */
export async function stageWarpFiles(
  machine: Machine,
  system: WarpSystem,
  paths: CliPaths,
): Promise<void> {
  const stage = warpStageDir(paths);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true, mode: 0o700 });
  chmodSync(stage, 0o700);
  if (system.kind !== "apt" && system.kind !== "dnf") return;
  if (machine.which("gpg") === null) {
    throw new Error("gpg is missing; it checks Warp's signing key. Install gpg first");
  }
  const key = join(stage, "warp.asc");
  writeFileSync(key, await machine.fetchText(WARP_KEY_URL), { mode: 0o644 });
  const fingerprint = keyFingerprint(machine, stage, key);
  if (fingerprint !== WARP_KEY_FINGERPRINT) {
    throw new Error(
      `Warp's signing key changed: ${WARP_KEY_URL} now holds the key ${fingerprint || "(none)"}, ` +
        `and cc-smart-dev-kit expects ${WARP_KEY_FINGERPRINT}. Nothing was installed. ` +
        `If Warp really changed its key, a cc-smart-dev-kit update brings the new one; until then, install Warp by hand: ${WARP_DOWNLOAD_URL}`,
    );
  }
  if (system.kind === "apt") {
    const dearmor = machine.run([
      "gpg",
      "--dearmor",
      "--yes",
      "--output",
      join(stage, "warpdotdev.gpg"),
      join(stage, "warp.asc"),
    ]);
    if (dearmor.exitCode !== 0) {
      throw new Error(`gpg --dearmor failed on Warp's key: ${dearmor.output.trim()}`);
    }
    // This machine's architecture, as Warp's own package writes it (its postinst).
    writeFileSync(join(stage, "warpdotdev.sources"), aptSourceText(system.arch), { mode: 0o644 });
  }
  if (system.kind === "dnf") {
    writeFileSync(join(stage, "warpdotdev.repo"), YUM_REPO_TEXT, { mode: 0o644 });
  }
}

/** The commands that take the Warp app, its package source and its key out again. */
export function warpRemoveCommands(machine: Machine, system: WarpSystem, app: WarpApp): string[][] {
  const commands: string[][] = [];
  switch (system.kind) {
    case "apt": {
      if (app.installed) commands.push(["sudo", "apt-get", "purge", "-y", PACKAGE]);
      const files = [APT_SOURCE, APT_LIST, APT_KEY, APT_GUIDE_KEY].filter(machine.exists);
      if (files.length > 0) commands.push(["sudo", "rm", "-f", ...files]);
      break;
    }
    case "dnf": {
      if (app.installed) commands.push(["sudo", "dnf", "remove", "-y", PACKAGE]);
      if (machine.exists(YUM_REPO)) commands.push(["sudo", "rm", "-f", YUM_REPO]);
      // rpm keeps each imported key as a gpg-pubkey package whose version is the key's id:
      // the last 8 hex digits of its fingerprint (or more of it, in newer rpm). Only the
      // one matching the pinned fingerprint is Warp's; a name or summary proves nothing.
      const keys = machine.run([
        "rpm",
        "-q",
        "gpg-pubkey",
        "--qf",
        "%{NAME}-%{VERSION}-%{RELEASE}\t%{VERSION}\n",
      ]);
      const pinned = WARP_KEY_FINGERPRINT.toLowerCase();
      const warpKeys =
        keys.exitCode === 0
          ? keys.output
              .split("\n")
              .filter((line) => {
                const id = (line.split("\t")[1] ?? "").trim().toLowerCase();
                return /^[0-9a-f]{8,}$/.test(id) && pinned.endsWith(id);
              })
              .map((line) => line.split("\t")[0] ?? "")
              .filter((name) => name !== "")
          : [];
      if (warpKeys.length > 0) commands.push(["sudo", "rpm", "-e", ...warpKeys]);
      break;
    }
    case "brew":
      if (app.installed && app.viaBrew) commands.push(["brew", "uninstall", "--cask", "warp"]);
      break;
    case "none":
      break;
  }
  return commands;
}

/** The person's own Warp shortcuts: on the desktop, and in their applications menu. */
export function warpDesktopEntries(paths: CliPaths): string[] {
  return [
    join(paths.home, "Desktop", DESKTOP_ENTRY),
    join(paths.home, ".local", "share", "applications", DESKTOP_ENTRY),
  ].filter((file) => existsSync(file));
}

/** Removes the person's Warp shortcuts, each after a backup. Returns the lines to print. */
export function removeWarpDesktopEntries(paths: CliPaths, dryRun: boolean): string[] {
  return warpDesktopEntries(paths).map((file) => {
    if (!dryRun) removeManagedFile(paths.stateDir, file);
    return `- ${tildify(file, paths.home)}: Warp shortcut removed`;
  });
}

/** One `claude` command for Warp's plugin, and the line it prints. */
export interface PluginStep {
  argv: string[];
  line: string;
}

/** The steps that add Warp's Claude plugin. Empty when it is installed already. */
export function warpPluginSteps(paths: CliPaths): PluginStep[] {
  if (findUserInstall(paths.installedPluginsFile, WARP_PLUGIN_ID) !== null) return [];
  const steps: PluginStep[] = [];
  if (!marketplaceAdded(paths, WARP_MARKETPLACE)) {
    const source = MARKETPLACE_SOURCES[WARP_MARKETPLACE] ?? "";
    steps.push({
      argv: ["claude", "plugin", "marketplace", "add", source],
      line: `+ marketplace ${WARP_MARKETPLACE} (${source})`,
    });
  }
  steps.push({
    argv: ["claude", "plugin", "install", WARP_PLUGIN_ID],
    line: `+ plugin ${WARP_PLUGIN_ID}`,
  });
  return steps;
}

/** True when an installed plugin other than `except` comes from `marketplace`. */
function otherPluginFrom(paths: CliPaths, marketplace: string, except: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(paths.installedPluginsFile, "utf8")) as {
      plugins?: Record<string, unknown>;
    };
    return Object.keys(parsed.plugins ?? {}).some(
      (id) => id !== except && id.endsWith(`@${marketplace}`),
    );
  } catch {
    return false;
  }
}

/** The steps that take Warp's Claude plugin out, and its marketplace when nothing else uses it. */
export function warpPluginRemoveSteps(paths: CliPaths): PluginStep[] {
  const steps: PluginStep[] = [];
  if (findUserInstall(paths.installedPluginsFile, WARP_PLUGIN_ID) !== null) {
    steps.push({
      argv: ["claude", "plugin", "uninstall", WARP_PLUGIN_ID],
      line: `- plugin ${WARP_PLUGIN_ID}`,
    });
  }
  if (
    marketplaceAdded(paths, WARP_MARKETPLACE) &&
    !otherPluginFrom(paths, WARP_MARKETPLACE, WARP_PLUGIN_ID)
  ) {
    steps.push({
      argv: ["claude", "plugin", "marketplace", "remove", WARP_MARKETPLACE],
      line: `- marketplace ${WARP_MARKETPLACE}`,
    });
  }
  return steps;
}

/** A command as the person reads it. */
export function showCommand(argv: readonly string[]): string {
  return argv
    .map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`))
    .join(" ");
}

/**
 * Doctor's Warp line: the app, its version, its plugin, and a plugin left with no app.
 * Warp is optional, and so is its plugin: the app without the plugin, or with the plugin
 * turned off, is information, never a failure.
 */
export function warpCheck(
  machine: Machine,
  paths: CliPaths,
): { ok: boolean; info?: boolean; text: string } {
  const app = detectWarpApp(machine, detectSystem(machine));
  const plugin = findUserInstall(paths.installedPluginsFile, WARP_PLUGIN_ID) !== null;
  const version = app.version === null ? "" : ` ${app.version}`;
  if (!app.installed && !plugin) {
    return {
      ok: true,
      info: true,
      text: "Warp: not installed (optional: cc-smart-dev-kit setup --warp)",
    };
  }
  if (!app.installed) {
    return {
      ok: false,
      text: `the Warp Claude plugin ${WARP_PLUGIN_ID} is installed, but the Warp app is not. Run: cc-smart-dev-kit setup --remove-warp (or cc-smart-dev-kit setup --warp)`,
    };
  }
  if (!plugin) {
    return {
      ok: true,
      info: true,
      text: `Warp${version} is installed, without its Claude plugin (optional: cc-smart-dev-kit setup --warp)`,
    };
  }
  if (!pluginEnabled(paths, WARP_PLUGIN_ID)) {
    return {
      ok: true,
      info: true,
      text: `Warp${version} is installed, with its Claude plugin turned off (optional: claude plugin enable ${WARP_PLUGIN_ID})`,
    };
  }
  return { ok: true, text: `Warp${version} is installed, with its Claude plugin` };
}

/** Removes the staged files again. */
export function clearWarpStage(paths: CliPaths): void {
  try {
    rmSync(warpStageDir(paths), { recursive: true, force: true });
  } catch (error) {
    console.log(`  could not remove ${warpStageDir(paths)}: ${messageOf(error)}`);
  }
}
