/**
 * A machine with a Google Chrome on it, for the browser's tests: a real temp home, with the
 * profile folder, `Local State`, `Preferences` and the extension in it exactly where Chrome keeps
 * them — and NOTHING under the real `~/.config`.
 *
 * The Chrome executable and the registry are fakes: `exists` answers for the one executable this
 * world claims, `spawnDetached` records what a real run would have started, and `run` records the
 * `reg` calls and answers what the test says. Everything else is a real file, because the managed
 * writers (`applyManagedJson`) read and write the file itself.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ChromeDeps,
  CLAUDE_CODE_PROFILE,
  chromeCandidates,
  PLAYWRIGHT_EXTENSION_ID,
} from "../browser/chrome";
import { type BrowserSetupDeps, type BrowserSetupState, browserSetup } from "../browser/setup";
import { writeBrowserToken } from "../browser/token";
import { cliPaths } from "../cli/paths";
import type { Machine } from "../machine/machine";
import { tempDir } from "./temp";

/**
 * One extension a test puts in the profile, as Chrome would have it there: a folder with a
 * version and a manifest (or not), and the record `Preferences` keeps for it (or none).
 * The defaults describe an extension a person installed from the Web Store.
 */
export interface WorldExtension {
  id: string;
  /** A folder holding a version and a manifest (default true). */
  folder?: boolean;
  /** The manifest's `name` (default: `messageKey` if given, else the id). */
  name?: string;
  /** Write `__MSG_<key>__` as the name, and resolve it from `_locales/en/messages.json`. */
  messageKey?: string;
  /** Chrome's `location` (`ManifestLocation`): 1 an install a person made, 5/10 Chrome's own. */
  location?: number;
  /** Chrome's `was_installed_by_default` mark. */
  installedByDefault?: boolean;
  /** No record in `Preferences` at all (Chrome keeps one after an extension is removed). */
  noRecord?: boolean;
}

export interface ChromeWorldOptions {
  platform?: NodeJS.Platform;
  /** The Chrome executable exists (default: yes). */
  chrome?: boolean;
  /** A `SingletonLock` target, read as Chrome's own lock is. */
  lock?: string | null;
}

export interface ChromeWorld {
  /** The Chrome executable this world claims: this platform's first candidate. */
  chrome: string;
  /** What `browser setup` was told to start, one line per call. */
  detached: string[];
  deps: BrowserSetupDeps;
  home: string;
  paths: ReturnType<typeof cliPaths>;
  profileDir: string;
  /**
   * What `run` answers for one `reg` verb (`query`, `add`, `delete`): the Windows registry fake.
   * Everything else answers `exitCode: 1`, and so does a verb nobody set.
   */
  answer: (verb: "add" | "delete" | "query", result: { exitCode: number; output: string }) => void;
  /** What `run` was asked, one line per call. */
  runs: string[];
  state: () => BrowserSetupState;
  /**
   * The profile folder, with the extension unpacked into it and Preferences written. `profileName`
   * is the display name Chrome itself would have put in `Preferences` (`profile.name`): a
   * profile Chrome made is named "Person 1" there, and `browser setup` writes `claude-code`.
   */
  withProfile: (options?: {
    extension?: boolean;
    fileUrls?: boolean;
    /** Extensions the person or Chrome put in the profile, each exactly as Chrome records it. */
    others?: WorldExtension[];
    /** Chrome's own `Temp` folder under `Extensions/`: no manifest, gone after an install. */
    tempFolder?: boolean;
    profileName?: string;
  }) => void;
  userDataDir: string;
}

export function chromeWorld(options: ChromeWorldOptions = {}): ChromeWorld {
  const platform = options.platform ?? "linux";
  const home = tempDir("browser-world");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  const userDataDir = join(
    home,
    ...(platform === "darwin"
      ? ["Library", "Application Support", "Google", "Chrome"]
      : platform === "win32"
        ? ["AppData", "Local", "Google", "Chrome", "User Data"]
        : [".config", "google-chrome"]),
  );
  const profileDir = join(userDataDir, CLAUDE_CODE_PROFILE);
  const chromePath = chromeCandidates(platform, home)[0] ?? "";
  const detached: string[] = [];
  const runs: string[] = [];
  const answers: Record<string, { exitCode: number; output: string }> = {};
  const chrome = options.chrome ?? true;

  const deps: BrowserSetupDeps = {
    // The Chrome candidates answer from this world alone: the machine running the test may
    // have a real Chrome, and a test about "no Chrome" must not find it.
    exists: (path) => {
      if (path === chromePath) return chrome;
      // No other Chrome candidate answers: the machine running the test may have a real one.
      if (chromeCandidates(platform, home).includes(path)) return false;
      return existsSync(path);
    },
    home,
    platform,
    readdir: (dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    },
    readFile: (file) => {
      try {
        return readFileSync(file, "utf8");
      } catch {
        return null;
      }
    },
    readlink: () => options.lock ?? null,
    run: (argv) => {
      runs.push(argv.join(" "));
      return answers[argv[1] ?? ""] ?? { exitCode: 1, output: "" };
    },
    spawnDetached: (argv) => detached.push(argv.join(" ")),
  };

  const withProfile: ChromeWorld["withProfile"] = (how = {}) => {
    mkdirSync(userDataDir, { recursive: true });
    mkdirSync(profileDir, { recursive: true });
    if (how.extension !== false) {
      mkdirSync(join(profileDir, "Extensions", PLAYWRIGHT_EXTENSION_ID, "0.4.0"), {
        recursive: true,
      });
    }
    // Chrome's own Temp folder: under `Extensions/`, no manifest, and gone afterwards.
    if (how.tempFolder === true) {
      mkdirSync(join(profileDir, "Extensions", "Temp"), { recursive: true });
    }
    const records: Record<string, unknown> = {};
    for (const other of how.others ?? []) {
      if (other.folder !== false) {
        const version = join(profileDir, "Extensions", other.id, "1.0.0");
        mkdirSync(version, { recursive: true });
        const name =
          other.messageKey === undefined ? (other.name ?? other.id) : `__MSG_${other.messageKey}__`;
        writeFileSync(
          join(version, "manifest.json"),
          JSON.stringify({ manifest_version: 3, name, version: "1.0.0" }),
        );
        if (other.messageKey !== undefined) {
          const locale = join(version, "_locales", "en");
          mkdirSync(locale, { recursive: true });
          writeFileSync(
            join(locale, "messages.json"),
            JSON.stringify({ [other.messageKey]: { message: other.name ?? other.id } }),
          );
        }
      }
      if (other.noRecord !== true) {
        records[other.id] = {
          location: other.location ?? 1,
          ...(other.installedByDefault === true ? { was_installed_by_default: true } : {}),
        };
      }
    }
    // A populated record IS "installed" (Playwright's own rule), so a world without the
    // extension writes none: only the unpacked folder and the record together mean installed.
    writeFileSync(
      join(profileDir, "Preferences"),
      JSON.stringify({
        extensions: {
          settings: {
            ...(how.extension === false
              ? {}
              : { [PLAYWRIGHT_EXTENSION_ID]: { newAllowFileAccess: how.fileUrls === true } }),
            ...records,
          },
        },
        // What Chrome puts in a profile it made itself; `browser setup` renames it.
        ...(how.profileName === undefined ? {} : { profile: { name: how.profileName } }),
      }),
    );
    writeFileSync(
      join(userDataDir, "Local State"),
      JSON.stringify({ profile: { info_cache: { [CLAUDE_CODE_PROFILE]: { name: "Person 1" } } } }),
    );
  };

  return {
    chrome: chromePath,
    deps,
    detached,
    home,
    paths,
    profileDir,
    answer: (verb, result) => {
      answers[verb] = result;
    },
    runs,
    state: () => browserSetup(paths, deps, { apply: false }).state,
    userDataDir,
    withProfile,
  };
}

/** A `Machine` whose Chrome facts are this world's: enough for the portal's Browser card. */
export function chromeMachine(world: ChromeWorld): Machine {
  return {
    arch: "x64",
    confirm: null,
    exists: world.deps.exists ?? (() => false),
    fetchText: async () => "",
    macApp: join(world.home, "no-Warp.app"),
    osRelease: () => 'NAME="Ubuntu"\n',
    platform: world.deps.platform,
    run: world.deps.run ?? (() => ({ exitCode: 1, output: "" })),
    runOnTerminal: () => 0,
    spawnDetached: world.deps.spawnDetached,
    which: () => null,
  };
}

/** A token file for this world, 0600, in the shape the extension's own token has. */
export function writeWorldToken(world: ChromeWorld, token = `${"A".repeat(40)}_-b`): void {
  writeBrowserToken(world.paths, token);
}

/** The Chrome deps alone, for a test that only needs `chrome.ts`'s checks. */
export function chromeDepsOf(world: ChromeWorld): ChromeDeps {
  return world.deps;
}
