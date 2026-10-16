/**
 * The person's own Google Chrome: where it is, where its profiles are, and what is in the one
 * profile cc-smart-dev-kit uses.
 *
 * WHY THIS EXISTS
 *   Extension mode (`browser mcp`) does not start a browser of its own. It drives the Chrome the
 *   person already has, through the Playwright extension, in ONE profile of its own —
 *   `--profile-dir-name=claude-code` (`src/browser/launcher.ts`). So three things have to be
 *   found or checked without starting anything:
 *   - where Chrome is installed, per OS;
 *   - which folder holds the `claude-code` profile (`browser setup` makes it; `doctor` checks
 *     it);
 *   - whether the Playwright extension is in that profile, whether anything else is, and
 *     whether that profile allows file:// pages.
 *
 * THE CHECKS ARE PLAYWRIGHT'S OWN
 *   `@playwright/mcp` refuses to start on a profile whose extension is missing, and it decides
 *   that from the FILES: `<profile>/Extensions/<id>/`, or a non-empty `extensions.settings[<id>]`
 *   record in `Preferences`/`Secure Preferences` (playwright-core's
 *   `tools/utils/extension.ts`). The checks here are the same ones, so `doctor` and the MCP can
 *   never disagree — and neither of them starts Chrome.
 *
 * ALLOW ACCESS TO FILE URLS
 *   Chrome keeps that switch per extension: `extensions.settings.<id>.newAllowFileAccess` in the
 *   profile's `Preferences` or `Secure Preferences` (Chromium's
 *   `extensions/browser/extension_prefs.cc`, `kPrefAllowFileAccess = "newAllowFileAccess"`;
 *   the pre-rename key was `allowFileAccess`, read here too). It is READ ONLY, always: those
 *   files are hash-signed, and Chrome resets an edit.
 *
 * NOTHING HERE READS THE ENVIRONMENT
 *   The home folder, the platform and the file calls are arguments, so a test points them at a
 *   temp folder (`.claude/rules/browser.md`).
 */

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { hostname } from "node:os";
import { join, win32 } from "node:path";

/** The Playwright extension's Chrome Web Store id (also its manifest `key`). */
export const PLAYWRIGHT_EXTENSION_ID = "mmlmfjhmonkocbjadbfplnigmagldckm";

/** Its Web Store page: where a person clicks "Add to Chrome". */
export const PLAYWRIGHT_EXTENSION_URL = `https://chromewebstore.google.com/detail/playwright-extension/${PLAYWRIGHT_EXTENSION_ID}`;

/** Its own page in Chrome, where "Allow access to file URLs" is switched on. */
export const PLAYWRIGHT_EXTENSION_SETTINGS_URL = `chrome://extensions/?id=${PLAYWRIGHT_EXTENSION_ID}`;

/** The one profile cc-smart-dev-kit uses, by its DIRECTORY name (what `--profile-dir-name` takes). */
export const CLAUDE_CODE_PROFILE = "claude-code";

/** The profile key that means "the whole profile folder allows file:// pages". */
const FILE_ACCESS_KEYS = ["newAllowFileAccess", "allowFileAccess"] as const;

/** What these checks ask of the machine. A test passes its own; the defaults are the machine. */
export interface ChromeDeps {
  /** True when a path exists. */
  exists?: (path: string) => boolean;
  /** The home folder, for the candidates that live under it (Windows' per-user Chrome). */
  home?: string;
  /** The platform whose rules apply. */
  platform?: NodeJS.Platform;
  /** The names in a folder; `[]` when it cannot be read. */
  readdir?: (dir: string) => string[];
  /** A file's text, or null when it cannot be read. */
  readFile?: (file: string) => null | string;
  /**
   * Windows only: opens the profile's `lockfile` for reading and writing and closes it again.
   * It throws as the system does when Chrome has it open. Defaults to the real call.
   */
  openLockfile?: (file: string) => void;
  /** macOS and Linux only: a symlink's target, or null when there is none. */
  readlink?: (path: string) => null | string;
  /** Is a process with this pid running? */
  isAlive?: (pid: number) => boolean;
  /** This machine's name, for reading a leftover `SingletonLock`. */
  hostname?: () => string;
}

function existsIn(deps: ChromeDeps): (path: string) => boolean {
  return deps.exists ?? existsSync;
}

function readFileIn(deps: ChromeDeps): (file: string) => null | string {
  return (
    deps.readFile ??
    ((file) => {
      try {
        return readFileSync(file, "utf8");
      } catch {
        return null;
      }
    })
  );
}

function readdirIn(deps: ChromeDeps): (dir: string) => string[] {
  return (
    deps.readdir ??
    ((dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    })
  );
}

/** Where Google Chrome is installed on this platform, in the order they are tried. */
export function chromeCandidates(platform: NodeJS.Platform, home: string): string[] {
  if (platform === "darwin") {
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  if (platform === "win32") {
    return [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      // A Chrome installed for one user only, under the home folder.
      win32.join(home, "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
    ];
  }
  return [
    "/opt/google/chrome/chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
}

/** The Google Chrome executable on this machine, or `null` when none is installed. */
export function findChrome(deps: ChromeDeps = {}): null | string {
  const exists = existsIn(deps);
  const home = deps.home ?? "";
  const platform = deps.platform ?? process.platform;
  return chromeCandidates(platform, home).find((path) => exists(path)) ?? null;
}

/**
 * The folder every Chrome profile of this user lives in (`--user-data-dir`), per OS — the same
 * three Playwright maps a browser channel to (`defaultUserDataDirForChannel`).
 *
 * `null` where this plugin knows of none. A Chromium or Brave install keeps its own folder, and
 * a person who runs one of those has to pass `--user-data-dir` to the MCP themselves; the plugin
 * supports Google Chrome and Edge first.
 */
export function chromeUserDataDir(platform: NodeJS.Platform, home: string): null | string {
  if (platform === "darwin")
    return join(home, "Library", "Application Support", "Google", "Chrome");
  if (platform === "win32")
    return win32.join(home, "AppData", "Local", "Google", "Chrome", "User Data");
  return join(home, ".config", "google-chrome");
}

/** The profile Chrome is asked for, and how it was found. */
export interface ChromeProfile {
  /** The profile folder: `<userDataDir>/<dirName>`. */
  dir: string;
  /** The DIRECTORY name, which is what `--profile-dir-name` takes. */
  dirName: string;
  /** The name shown in Chrome's own profile menu, when `Local State` says. */
  displayName: null | string;
  /**
   * `directory`: the folder `<userDataDir>/claude-code` is there. `local-state`: `Local State`
   * names a profile `claude-code`, and its folder has another name (`Profile 1`) — the route of
   * a profile made with Chrome's own "Add profile" dialog.
   */
  found: "directory" | "local-state";
}

/** One profile of `Local State`'s `profile.info_cache`. */
interface InfoCacheEntry {
  dirName: string;
  name: null | string;
}

/** Every profile `Local State` knows, in its own order (empty when it cannot be read). */
export function infoCache(userDataDir: string, deps: ChromeDeps = {}): InfoCacheEntry[] {
  const text = readFileIn(deps)(join(userDataDir, "Local State"));
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A half-written or unreadable Local State is not a reason to fail: the folder check
    // below still answers, and Chrome rewrites this file itself.
    return [];
  }
  const cache = (parsed as { profile?: { info_cache?: unknown } } | null)?.profile?.info_cache;
  if (typeof cache !== "object" || cache === null) return [];
  const entries: InfoCacheEntry[] = [];
  for (const [dirName, value] of Object.entries(cache as Record<string, unknown>)) {
    const name = (value as { name?: unknown } | null)?.name;
    entries.push({ dirName, name: typeof name === "string" ? name : null });
  }
  return entries;
}

/**
 * The `claude-code` profile of this Chrome, or `null` when there is none yet.
 *
 * The folder `<userDataDir>/claude-code` is what `--profile-dir-name=claude-code` needs, so it
 * is looked for first — that is the profile `browser setup` makes. Chrome's own "Add profile"
 * dialog makes a folder `Profile N` with a display name you typed, so `Local State` is the
 * second route: a profile the person named `claude-code` there is used by its directory name.
 */
export function findClaudeCodeProfile(
  userDataDir: string,
  deps: ChromeDeps = {},
): ChromeProfile | null {
  const cache = infoCache(userDataDir, deps);
  const nameOf = (dirName: string) =>
    cache.find((entry) => entry.dirName === dirName)?.name ?? null;
  const directory = join(userDataDir, CLAUDE_CODE_PROFILE);
  if (existsIn(deps)(directory)) {
    return {
      dir: directory,
      dirName: CLAUDE_CODE_PROFILE,
      displayName: nameOf(CLAUDE_CODE_PROFILE),
      found: "directory",
    };
  }
  const named = cache.find((entry) => entry.name === CLAUDE_CODE_PROFILE);
  if (named !== undefined && existsIn(deps)(join(userDataDir, named.dirName))) {
    return {
      dir: join(userDataDir, named.dirName),
      dirName: named.dirName,
      displayName: named.name,
      found: "local-state",
    };
  }
  return null;
}

/**
 * The name a profile's OWN `Preferences` carries (`profile.name`), or null when the file is not
 * there or holds none. Chrome shows the picker's name from `Local State` and falls back to this
 * one, so both have to say `claude-code` (live, 2026-10-17: a person saw the profile unnamed
 * although `Local State` said otherwise).
 *
 * This one key is the only thing ever read or written in `Preferences`: every other key of it,
 * and every byte of `Secure Preferences`, stays Chrome's own (`allowsFileUrls` only reads them).
 */
export function profileNameIn(profileDir: string, deps: ChromeDeps = {}): null | string {
  const text = readFileIn(deps)(join(profileDir, "Preferences"));
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const name = (parsed as { profile?: { name?: unknown } } | null)?.profile?.name;
  return typeof name === "string" ? name : null;
}

/** The extension folders in one profile, by extension id. */
function extensionIds(profileDir: string, deps: ChromeDeps): string[] {
  return readdirIn(deps)(join(profileDir, "Extensions"));
}

/** One extension's record in `Preferences`/`Secure Preferences`, or null when there is none. */
function extensionRecord(
  profileDir: string,
  id: string,
  deps: ChromeDeps,
): Record<string, unknown> | null {
  const read = readFileIn(deps);
  for (const fileName of ["Preferences", "Secure Preferences"]) {
    const text = read(join(profileDir, fileName));
    if (text === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const settings = (parsed as { extensions?: { settings?: unknown } } | null)?.extensions
      ?.settings;
    if (typeof settings !== "object" || settings === null) continue;
    const record = (settings as Record<string, unknown>)[id];
    if (typeof record === "object" && record !== null && Object.keys(record).length > 0) {
      return record as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * Is the Playwright extension installed in this profile? The same file-level test `@playwright/mcp`
 * runs before it connects: the unpacked folder, or a populated settings record. An uninstalled
 * extension leaves an empty record behind, which is why the record must not be empty.
 */
export function isExtensionInstalledInProfile(profileDir: string, deps: ChromeDeps = {}): boolean {
  if (extensionIds(profileDir, deps).includes(PLAYWRIGHT_EXTENSION_ID)) return true;
  return extensionRecord(profileDir, PLAYWRIGHT_EXTENSION_ID, deps) !== null;
}

/** The installed extension's version (`<profile>/Extensions/<id>/<version>/`), or null. */
export function extensionVersion(profileDir: string, deps: ChromeDeps = {}): null | string {
  const folder = join(profileDir, "Extensions", PLAYWRIGHT_EXTENSION_ID);
  const versions = readdirIn(deps)(folder).filter((name) => name !== "_metadata");
  return versions.sort().at(-1) ?? null;
}

/** One extension in the profile that is not this plugin's, as the person can recognise it. */
export interface OtherExtension {
  id: string;
  /** The manifest's own name, or the id when it cannot be read (`__MSG_…__` and all). */
  name: string;
}

/** The extensions directory's own bookkeeping folder, never an extension. */
const EXTENSIONS_METADATA = "_metadata";

/**
 * Chrome's own extensions, by the record it keeps: `location` is `ManifestLocation` and
 * `was_installed_by_default` marks one that came with the browser or the system.
 *
 * The values, from Chromium's own source (`extensions/common/mojom/manifest.mojom`, read
 * 2026-10-17): 0 kInvalidLocation, 1 kInternal, 2 kExternalPref, 3 kExternalRegistry,
 * 4 kUnpacked, 5 kComponent, 6 kExternalPrefDownload, 7 kExternalPolicyDownload,
 * 8 kCommandLine, 9 kExternalPolicy, 10 kExternalComponent. The file says the numbers are
 * stored in the preferences and must keep their meaning, so they are safe to read.
 *
 * 5 (kComponent: "an integral component of Chrome itself, which happens to be implemented as
 * an extension") and 10 (kExternalComponent: "considered an internal implementation detail of
 * chrome") are Chrome's own: they are hidden from `chrome://extensions` and cannot be removed
 * there, so naming them is a false alarm. `was_installed_by_default` is Chrome's own mark for
 * the same class (the Web Store Payments extension carries both).
 */
export function isChromesOwnExtension(record: Record<string, unknown>): boolean {
  if (record.was_installed_by_default === true) return true;
  const location = record.location;
  return location === 5 || location === 10;
}

/**
 * The installed version folder of ONE extension that really holds a manifest, or null.
 *
 * A folder without a manifest is not an extension: Chrome's own `Temp` folder sits under
 * `<profile>/Extensions/` while an install runs, has no manifest, and is gone afterwards — it
 * was named as "another extension" once (live, 2026-10-17).
 */
export function installedExtensionVersion(
  profileDir: string,
  id: string,
  deps: ChromeDeps = {},
): null | string {
  const read = readFileIn(deps);
  const versions = readdirIn(deps)(join(profileDir, "Extensions", id))
    .filter((name) => name !== EXTENSIONS_METADATA)
    .sort()
    .reverse();
  for (const version of versions) {
    const manifest = read(join(profileDir, "Extensions", id, version, "manifest.json"));
    if (manifest === null) continue;
    try {
      JSON.parse(manifest);
      return version;
    } catch {}
  }
  return null;
}

/** A manifest's `name`, with a `__MSG_key__` placeholder resolved from the extension's locales. */
export function extensionName(
  profileDir: string,
  id: string,
  version: string,
  deps: ChromeDeps = {},
): string {
  const read = readFileIn(deps);
  const folder = join(profileDir, "Extensions", id, version);
  let manifest: Record<string, unknown> | null = null;
  try {
    manifest = JSON.parse(read(join(folder, "manifest.json")) ?? "") as Record<string, unknown>;
  } catch {
    return id;
  }
  const raw = typeof manifest?.name === "string" ? manifest.name : "";
  const locale = typeof manifest?.default_locale === "string" ? manifest.default_locale : "";
  const placeholder = /^__MSG_(.+)__$/.exec(raw);
  if (placeholder === null) return raw.trim() === "" ? id : raw.trim();
  const key = placeholder[1] ?? "";
  // The manifest's own locale first, then English, then whatever locale the extension ships:
  // the message file is `<profile>/Extensions/<id>/<version>/_locales/<locale>/messages.json`.
  const locales = readdirIn(deps)(join(folder, "_locales")).filter(
    (name) => name !== EXTENSIONS_METADATA,
  );
  const order = [locale, "en", "en_US", ...locales].filter((name) => name !== "");
  for (const name of order) {
    let messages: Record<string, unknown> | null = null;
    try {
      messages = JSON.parse(read(join(folder, "_locales", name, "messages.json")) ?? "") as Record<
        string,
        unknown
      >;
    } catch {
      continue;
    }
    const entry = messages?.[key];
    const message = (entry as { message?: unknown } | null)?.message;
    if (typeof message === "string" && message.trim() !== "") return message.trim();
  }
  return id;
}

/**
 * Every extension in this profile that is NOT this plugin's, judged by Chrome's own record
 * rather than by the folders on disk:
 *   - a folder with a manifest (Chrome's `Temp`, or a folder left behind, is not one);
 *   - and a `Preferences` / `Secure Preferences` record that is not Chrome's own
 *     (`isChromesOwnExtension`: component, external-component, installed by default).
 *
 * `doctor` warns about these by name: one that injects a frame into pages breaks a browser
 * session (microsoft/playwright#43230, open). Entries with a record but no folder are left out
 * too — Chrome keeps the record after an extension is gone, which was the other half of the
 * same false alarm.
 */
export function otherExtensions(profileDir: string, deps: ChromeDeps = {}): OtherExtension[] {
  const found: OtherExtension[] = [];
  for (const id of extensionIds(profileDir, deps)) {
    if (id === PLAYWRIGHT_EXTENSION_ID || id === EXTENSIONS_METADATA) continue;
    const version = installedExtensionVersion(profileDir, id, deps);
    if (version === null) continue;
    const record = extensionRecord(profileDir, id, deps);
    if (record !== null && isChromesOwnExtension(record)) continue;
    found.push({ id, name: extensionName(profileDir, id, version, deps) });
  }
  return found;
}

/**
 * Does that profile allow `file://` pages?
 *
 * `true` when `extensions.settings.<id>.newAllowFileAccess` is true in `Preferences` or
 * `Secure Preferences`; `false` when those files are there and it is not; `null` when neither
 * file can be read at all, so nothing can be said. Never written: Chrome hash-signs those files
 * and resets an edit.
 */
export function allowsFileUrls(profileDir: string, deps: ChromeDeps = {}): boolean | null {
  const read = readFileIn(deps);
  let readAny = false;
  for (const fileName of ["Preferences", "Secure Preferences"]) {
    const text = read(join(profileDir, fileName));
    if (text === null) continue;
    readAny = true;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const settings = (parsed as { extensions?: { settings?: unknown } } | null)?.extensions
      ?.settings;
    if (typeof settings !== "object" || settings === null) continue;
    const record = (settings as Record<string, unknown>)[PLAYWRIGHT_EXTENSION_ID];
    if (typeof record !== "object" || record === null) continue;
    for (const key of FILE_ACCESS_KEYS) {
      if ((record as Record<string, unknown>)[key] === true) return true;
    }
  }
  return readAny ? false : null;
}

/** Is a process with this pid running? `EPERM` means it exists but is not ours. */
function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && String(error.code) === "EPERM";
  }
}

/**
 * May a Chrome be running on this user data folder?
 *
 * Asked before the ONE write the plugin ever makes inside Chrome's own folder — the profile's
 * display name in `Local State`, which Chrome overwrites from memory while it runs. It fails
 * SAFE: anything that cannot be read as "no Chrome" is reported as `true`, and the write is
 * then skipped and the guide tells the person to rename the profile in Chrome instead.
 *
 * - Windows: Chrome holds a file named `lockfile` in the folder open for as long as it runs,
 *   and Windows refuses a second open (EBUSY).
 * - macOS and Linux: Chrome writes a `SingletonLock` symlink whose target is `<host>-<pid>`.
 *   A lock naming this machine and a pid that no longer runs is a leftover from a crash, and
 *   reads as "not running". A lock from another machine cannot be judged here, so it counts
 *   as running.
 */
export function chromeMayBeRunning(
  userDataDir: string,
  platform: NodeJS.Platform,
  deps: ChromeDeps = {},
): boolean {
  if (platform === "win32") {
    const open =
      deps.openLockfile ??
      ((file: string) => {
        closeSync(openSync(file, "r+"));
      });
    try {
      open(join(userDataDir, "lockfile"));
      return false;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      return code !== "ENOENT";
    }
  }
  const readlink =
    deps.readlink ??
    ((path: string) => {
      try {
        return readlinkSync(path);
      } catch {
        return null;
      }
    });
  const target = readlink(join(userDataDir, "SingletonLock"));
  if (target === null) return false;
  // Chrome has no SingletonLock outside the profile's own folder, so a missing one is the
  // only certain answer; anything else is judged by the pid it names.
  const cut = target.lastIndexOf("-");
  const host = target.slice(0, cut);
  const pid = Number(target.slice(cut + 1));
  const alive = (deps.isAlive ?? isAlive)(pid);
  const here = host === (deps.hostname ?? hostname)();
  return !(here && !alive);
}
