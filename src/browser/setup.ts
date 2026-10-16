/**
 * `cc-smart-dev-kit browser setup` — the machine side of extension mode: find Chrome, make the
 * `claude-code` profile, get the Playwright extension into it, and print the five steps a person
 * follows. `cc-smart-dev-kit setup` prints the same lines (it never blocks on a browser).
 *
 * WHAT IT DOES BY ITSELF, AND WHAT IT NEVER DOES
 *   - It OPENS the extension's Web Store page in the `claude-code` profile (Chrome is started
 *     with `--profile-directory=<dir> --new-window <url>`; a profile folder that does not exist
 *     yet is made by Chrome on that launch). The person still clicks "Add to Chrome".
 *   - macOS and Windows only: it pre-registers the extension for that user (the per-user
 *     External Extensions JSON, the HKCU `update_url` key). The person still clicks Enable;
 *     `restore` removes what was registered.
 *   - It NEVER installs or removes an extension, and it never deletes a Chrome profile — not the
 *     `claude-code` one, and not the profile folder 0.3.0's shared browser left at
 *     `<dataDir>/playwright`. That folder may hold sign-ins, so it is the person's to remove; the
 *     lines say where it is and what to run (`legacy.ts`).
 *   - It writes ONE thing inside Chrome's own folder: the profile's DISPLAY name in `Local
 *     State`, and only while no Chrome runs on that user data folder (Chrome rewrites that file
 *     from memory while it runs). It goes through the managed-file helpers, so a backup is made
 *     and `restore` puts it back. The profile itself — its cookies, its logins, its extensions —
 *     is never touched.
 *
 * IDEMPOTENT
 *   Everything is checked before it is done: an extension already installed opens no page, a
 *   registry value already ours is not added again, a name already right is not written. A second
 *   run with nothing to do prints the state and the guide, and writes nothing.
 *
 * `--dry-run`
 *   The same steps, printed, and nothing run or written: no Chrome started, no file, no registry.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND } from "../build-info";
import type { CliPaths } from "../cli/paths";
import type { Machine } from "../machine/machine";
import { applyManagedJson } from "../setup/managed-json";
import { writeManagedFile } from "../setup/write";
import {
  allowsFileUrls,
  type ChromeDeps,
  CLAUDE_CODE_PROFILE,
  chromeCandidates,
  chromeMayBeRunning,
  chromeUserDataDir,
  findChrome,
  findClaudeCodeProfile,
  isExtensionInstalledInProfile,
  otherExtensionIds,
  PLAYWRIGHT_EXTENSION_ID,
  PLAYWRIGHT_EXTENSION_SETTINGS_URL,
  PLAYWRIGHT_EXTENSION_URL,
} from "./chrome";
import { legacyBrowserFacts, type ProcessReader } from "./legacy";
import { clearBrowserToken, readBrowserToken, type TokenDeps } from "./token";

/** The folders under the home where macOS keeps a user's extension pre-registrations. */
const MAC_EXTERNAL_EXTENSIONS = [
  "Library",
  "Application Support",
  "Google",
  "Chrome",
  "External Extensions",
];

/** The Web Store's own update URL, which is what a pre-registration carries. */
const CRX_UPDATE_URL = "https://clients2.google.com/service/update2/crx";

/** The registry key a pre-registered extension goes under, on Windows. */
const WINDOWS_KEY = `HKCU\\Software\\Google\\Chrome\\Extensions\\${PLAYWRIGHT_EXTENSION_ID}`;

/** What `browser setup` registered, so `restore` can take exactly that back. */
export function browserSetupRecordFile(stateDir: string): string {
  return join(stateDir, "browser-setup.json");
}

/** The record: which pre-registrations setup made (macOS's JSON file is a managed file instead). */
export interface BrowserSetupRecord {
  /** The HKCU key was added by setup. */
  windowsExtensionKey?: true;
}

export function readBrowserSetupRecord(stateDir: string): BrowserSetupRecord {
  const file = browserSetupRecordFile(stateDir);
  if (!existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as BrowserSetupRecord) : {};
  } catch {
    return {};
  }
}

function writeBrowserSetupRecord(stateDir: string): void {
  mkdirSync(stateDir, { mode: 0o700, recursive: true });
  writeManagedFile(
    browserSetupRecordFile(stateDir),
    `${JSON.stringify({ windowsExtensionKey: true } satisfies BrowserSetupRecord, null, 2)}\n`,
    { kind: "whole-file", stateDir },
  );
}

/** What these steps ask of the machine. `platform` and `home` are required; the rest default. */
export interface BrowserSetupDeps extends ChromeDeps, TokenDeps {
  home: string;
  platform: NodeJS.Platform;
  /**
   * Lists the running processes' command lines, for 0.3.0's leftovers (`legacy.ts`). Default:
   * the real listing for `platform`, through `run`.
   */
  processes?: ProcessReader;
  /** Starts Chrome and does not wait for it (a window opening is the point). */
  spawnDetached: (argv: string[]) => void;
  /** Runs a command and captures its output: the Windows registry, through `reg`. */
  run?: (argv: string[]) => { exitCode: number; output: string };
}

/** Where the setup stands: every line of the guide and every check answers from this. */
export interface BrowserSetupState {
  extensionInstalled: boolean;
  /** true, false, or null when the profile's own record could not be read. */
  fileUrls: boolean | null;
  /** The profile is there (only then is there a directory name to show). */
  profile: boolean;
  profileDirName: string;
  tokenSet: boolean;
}

export interface BrowserSetupResult {
  /** `+` created, `~` changed, `$` a command run (in a dry run: would run). */
  changes: string[];
  /** Two-space lines: what was found and what was left alone. */
  info: string[];
  /** `!` lines: what a person still has to do, or what could not be done. */
  notes: string[];
  /** The numbered guide to print after the lines above. */
  guide: string[];
  /** False when a step could not be done on this machine (never because a person has to click). */
  ok: boolean;
  state: BrowserSetupState;
}

/** One step of the guide: its sentence, the address it needs, and whether it is already done. */
export interface BrowserGuideStep {
  /** An address or a command the step needs, shown under it. */
  detail?: string;
  /** `true` done, `false` not done, `null` when nothing can check it (pinning, copying). */
  done: boolean | null;
  text: string;
}

/** The guide, structured: the CLI prints it, the portal's Browser card draws it. One home. */
export interface BrowserGuide {
  /** The line above the steps: which profile the window belongs to. */
  intro: string;
  /** What to know about the costs and the one rule about extensions. */
  notes: string[];
  steps: BrowserGuideStep[];
}

/**
 * The five steps, in the words a person follows — one home: `browser setup` prints them,
 * `cc-smart-dev-kit setup` prints them, and the portal's Browser card draws them. A step that is
 * already satisfied says so.
 */
export function browserGuide(state: BrowserSetupState): BrowserGuide {
  return {
    intro: `In the Chrome window of the "${state.profileDirName}" profile:`,
    notes: [
      "Nothing runs until the token is saved: without it the extension would ask you to approve every connection, so the plugin refuses to start.",
      "Do not add any other extension to this profile: one that injects into pages breaks the browser session (microsoft/playwright#43230, open).",
      "While a session uses the browser, Chrome comes to the front and switches this profile's active tab each time it connects: that is the extension's own behaviour (microsoft/playwright#42343, closed as not planned).",
    ],
    steps: [
      {
        done: state.extensionInstalled,
        text: 'Click "Add to Chrome", then "Add extension": that installs the Playwright extension in THIS profile only.',
      },
      {
        detail: PLAYWRIGHT_EXTENSION_SETTINGS_URL,
        done: state.fileUrls === true,
        text: 'Paste that into that window\'s address bar, then switch on "Allow access to file URLs".',
      },
      {
        done: null,
        text: "Pin the extension (the puzzle-piece menu), then click its icon: its status page opens.",
      },
      {
        done: null,
        text: "Press Copy next to PLAYWRIGHT_MCP_EXTENSION_TOKEN=<token> — it copies the whole line.",
      },
      {
        detail: `${COMMAND} browser token`,
        done: state.tokenSet,
        text: `Save it: run this, paste the line, then press Enter — or paste it into the Browser card of the portal (${COMMAND} portal).`,
      },
    ],
  };
}

/** The guide as the lines a command prints: numbered steps, then the notes. */
export function browserGuideLines(guide: BrowserGuide): string[] {
  const done = (step: BrowserGuideStep) =>
    step.done === null ? " (by hand)" : step.done ? " (done)" : "";
  return [
    guide.intro,
    ...guide.steps.flatMap((step, index) => [
      `${String(index + 1)}. ${step.text}${done(step)}`,
      ...(step.detail === undefined ? [] : [`   ${step.detail}`]),
    ]),
    ...guide.notes,
  ];
}

/** The macOS per-user pre-registration file for one extension. */
export function macExternalExtensionFile(home: string): string {
  return join(home, ...MAC_EXTERNAL_EXTENSIONS, `${PLAYWRIGHT_EXTENSION_ID}.json`);
}

/** The HKCU key's `reg` argv, for a caller that prints it (`--dry-run`) or runs it. */
export function windowsRegisterArgv(): string[] {
  return [
    "reg",
    "add",
    WINDOWS_KEY,
    "/v",
    "update_url",
    "/t",
    "REG_SZ",
    "/d",
    CRX_UPDATE_URL,
    "/f",
  ];
}

/** The `reg` argv that reads the key back, for a caller that checks before it removes anything. */
export function windowsQueryArgv(): string[] {
  return ["reg", "query", WINDOWS_KEY, "/v", "update_url"];
}

/**
 * What `restore` takes back for the browser: the token file, and the pre-registration setup added
 * on Windows (the macOS JSON file is a managed file, so `restore` handles it by itself).
 *
 * **It never touches the Chrome profile or the extension.** The profile folder, its cookies, its
 * logins and the installed extension are the person's browser data, not cc-smart-dev-kit's, and no
 * command deletes them. The one exception is the profile's display name in `Local State`: that is
 * a managed change like any other, so the general restore puts it back — and every other byte of
 * that file is left as it is.
 */
export function browserRestoreLines(
  paths: CliPaths,
  deps: {
    /** The record read BEFORE `restore` ran (restore removes that file). */
    record: BrowserSetupRecord;
    /** Runs a command and captures its output: the Windows registry, through `reg`. */
    run?: ((argv: string[]) => { exitCode: number; output: string }) | undefined;
  },
): { lines: string[]; profileTouched: boolean } {
  const lines: string[] = [];
  const removed = clearBrowserToken(paths);
  if (removed !== null) lines.push(`- ${removed}: removed (the browser token)`);
  if (deps.record.windowsExtensionKey === true && deps.run !== undefined) {
    const current = deps.run(windowsQueryArgv());
    if (current.exitCode === 0 && current.output.includes(CRX_UPDATE_URL)) {
      const deleted = deps.run(["reg", "delete", WINDOWS_KEY, "/f"]);
      lines.push(
        deleted.exitCode === 0
          ? `- ${WINDOWS_KEY}: removed (the extension pre-registration)`
          : `! ${WINDOWS_KEY} could not be removed (${deleted.output.trim().split("\n")[0] ?? "reg failed"}): remove it by hand`,
      );
    }
  }
  return { lines, profileTouched: removed !== null || deps.record.windowsExtensionKey === true };
}

/** A file's text, or null when it cannot be read (a missing pre-registration file is normal). */
function readFileSafely(file: string): null | string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * The machine's own deps, built from a `Machine` and the home folder — one home for the CLI, for
 * `cc-smart-dev-kit setup` and for the portal's Browser card, so all three ask the machine the
 * same way. The file calls are the real ones: every path they touch is under the home folder,
 * which a test points at a temp folder.
 */
export function realBrowserSetupDeps(
  machine: Pick<Machine, "exists" | "platform" | "run" | "spawnDetached">,
  home: string,
): BrowserSetupDeps {
  return {
    exists: machine.exists,
    home,
    platform: machine.platform,
    readdir: (dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    },
    readFile: readFileSafely,
    run: machine.run,
    spawnDetached: machine.spawnDetached,
  };
}

/**
 * The steps, run or only printed. `apply: false` is `--dry-run` and `cc-smart-dev-kit setup`:
 * every line is the same, and nothing is started or written. The result's `state` is always read
 * from the machine as it is, so a caller can say what is still missing.
 */
export function browserSetup(
  paths: CliPaths,
  deps: BrowserSetupDeps,
  options: { apply: boolean },
): BrowserSetupResult {
  const changes: string[] = [];
  const info: string[] = [];
  const notes: string[] = [];
  const emptyState: BrowserSetupState = {
    extensionInstalled: false,
    fileUrls: null,
    profile: false,
    profileDirName: CLAUDE_CODE_PROFILE,
    tokenSet: readBrowserToken(paths, deps).source === "file",
  };
  // What 0.3.0 left (`legacy.ts`) first: it is the one thing here a person may have to act on,
  // and it prints before the state of the `claude-code` profile this version uses. Information,
  // never a question — setup never deletes a person's browser data.
  info.push(...legacyBrowserInfo(paths, deps));

  const chrome = findChrome(deps);
  if (chrome === null) {
    notes.push(
      `! Google Chrome is not installed where cc-smart-dev-kit looks (${chromeCandidates(deps.platform, deps.home).join(", ")}). Install Google Chrome, then run: ${COMMAND} browser setup`,
    );
    return { changes, guide: [], info, notes, ok: false, state: emptyState };
  }
  info.push(`  Google Chrome: ${chrome}`);

  const userDataDir = chromeUserDataDir(deps.platform, deps.home);
  if (userDataDir === null) {
    notes.push(
      "! this system's Chrome profile folder is not one cc-smart-dev-kit knows: run Chrome with your own --user-data-dir, and pass --profile-dir-name to the browser yourself",
    );
    return { changes, guide: [], info, notes, ok: false, state: emptyState };
  }
  info.push(`  Chrome profiles: ${userDataDir}`);

  // macOS and Windows only: pre-register the extension for this user, so Chrome offers it in this
  // profile without a Web Store trip. The person still clicks Enable.
  if (deps.platform === "darwin") {
    const file = macExternalExtensionFile(deps.home);
    const wanted = `${JSON.stringify({ external_update_url: CRX_UPDATE_URL }, null, 2)}\n`;
    const there = readFileSafely(file);
    if (there === wanted) {
      info.push(`  the extension is pre-registered for this user already (${file})`);
    } else if (!options.apply) {
      changes.push(`+ ${file} (pre-registers the Playwright extension for this user)`);
    } else {
      const result = writeManagedFile(file, wanted, {
        expectedContent: there,
        kind: "whole-file",
        stateDir: paths.stateDir,
      });
      changes.push(`${result.outcome === "unchanged" ? "  " : "+"} ${file}`);
    }
  }
  if (deps.platform === "win32") {
    const run = deps.run;
    if (run === undefined) {
      info.push(
        "  the Windows registry is not reachable here; the guide's first step is the way in",
      );
    } else {
      const existing = run(windowsQueryArgv());
      const ours = existing.exitCode === 0 && existing.output.includes(CRX_UPDATE_URL);
      if (ours) {
        info.push("  the extension is pre-registered for this user already (HKCU)");
      } else if (!options.apply) {
        changes.push(`$ ${windowsRegisterArgv().join(" ")}`);
      } else {
        const added = run(windowsRegisterArgv());
        if (added.exitCode === 0) {
          writeBrowserSetupRecord(paths.stateDir);
          changes.push(`+ ${WINDOWS_KEY}: pre-registered the Playwright extension for this user`);
        } else {
          notes.push(
            `! the extension could not be pre-registered in the Windows registry (${added.output.trim().split("\n")[0] ?? "reg failed"}); add it from the Web Store page instead`,
          );
        }
      }
    }
  }

  const profile = findClaudeCodeProfile(userDataDir, deps);
  const extensionInstalled = profile !== null && isExtensionInstalledInProfile(profile.dir, deps);
  const dirName = profile?.dirName ?? CLAUDE_CODE_PROFILE;

  // The profile's display name: written only while no Chrome runs on this user data folder
  // (Chrome rewrites `Local State` from memory), and through the managed helpers.
  if (profile !== null && profile.displayName !== CLAUDE_CODE_PROFILE) {
    const localState = join(userDataDir, "Local State");
    if (chromeMayBeRunning(userDataDir, deps.platform, deps)) {
      info.push(
        `  Chrome is running, so the "${dirName}" profile's name was left as it is (Chrome rewrites ${localState}): rename it in Chrome (profile menu, Customize profile), or close Chrome and run this again`,
      );
    } else if (!options.apply) {
      changes.push(
        `~ ${localState}: profile.info_cache.${dirName}.name = "${CLAUDE_CODE_PROFILE}"`,
      );
    } else {
      try {
        const written = applyManagedJson({
          file: localState,
          set: [[["profile", "info_cache", dirName, "name"], CLAUDE_CODE_PROFILE]],
          stateDir: paths.stateDir,
          // Chrome names a profile it just made itself ("Person 1"), and a plugin cannot tell that
          // from a name a person typed. The profile is this plugin's own, and labelling it is the
          // whole point of the write; `restore` puts back whatever was there.
          unchosen: () => true,
        });
        changes.push(
          ...written.changes.map(
            (change) =>
              `${written.written ? "~" : "  "} ${localState}: ${change.path.join(".")} = ${JSON.stringify(change.after)}`,
          ),
        );
      } catch (error) {
        // A name that cannot be written is cosmetic: the directory name is what the MCP needs.
        notes.push(
          `! the profile could not be named "${CLAUDE_CODE_PROFILE}" in ${localState} (${error instanceof Error ? error.message : String(error)}); rename it in Chrome instead`,
        );
      }
    }
  }

  // Open the profile on the Web Store page: only while something is still missing there.
  if (profile === null || !extensionInstalled) {
    const argv = [
      chrome,
      `--profile-directory=${dirName}`,
      // Without it, a Chrome already running may only focus its existing window.
      "--new-window",
      PLAYWRIGHT_EXTENSION_URL,
    ];
    changes.push(`$ ${argv.join(" ")}`);
    if (options.apply) {
      try {
        deps.spawnDetached(argv);
      } catch (error) {
        notes.push(
          `! Chrome could not be started (${error instanceof Error ? error.message : String(error)}): open ${PLAYWRIGHT_EXTENSION_URL} in the "${dirName}" profile yourself`,
        );
      }
    }
    if (profile === null) {
      info.push(
        `  Chrome makes the "${dirName}" profile on this launch and names it itself: close Chrome and run this again to label it "${CLAUDE_CODE_PROFILE}", or rename it in Chrome`,
      );
    }
  }

  const found = findClaudeCodeProfile(userDataDir, deps);
  const others = found === null ? [] : otherExtensionIds(found.dir, deps);
  if (others.length > 0) {
    notes.push(
      `! ${String(others.length)} other extension${others.length === 1 ? "" : "s"} in the "${dirName}" profile (${others.join(", ")}): remove it there, or the browser session breaks (microsoft/playwright#43230, open)`,
    );
  }
  const state = browserState(paths, deps);
  if (state.tokenSet) info.push(`  the browser token is set (${paths.browserTokenFile})`);
  return { changes, guide: browserGuideLines(browserGuide(state)), info, notes, ok: true, state };
}

/**
 * Where the browser stands, from the files this plugin's own paths point at: the `claude-code`
 * profile in the home folder, the extension in it, the file-URL switch, and the token. The Chrome
 * EXECUTABLE is not asked about: it is a host fact, `doctor` and `browser setup` report it by
 * name, and leaving it out keeps this state — and everything `cc-smart-dev-kit setup` prints — the
 * same on every machine.
 */
export function browserState(paths: CliPaths, deps: BrowserSetupDeps): BrowserSetupState {
  const userDataDir = chromeUserDataDir(deps.platform, deps.home);
  const profile = userDataDir === null ? null : findClaudeCodeProfile(userDataDir, deps);
  const token = readBrowserToken(paths, deps);
  return {
    extensionInstalled: profile !== null && isExtensionInstalledInProfile(profile.dir, deps),
    fileUrls: profile === null ? null : allowsFileUrls(profile.dir, deps),
    profile: profile !== null,
    profileDirName: profile?.dirName ?? CLAUDE_CODE_PROFILE,
    tokenSet: token.source === "file",
  };
}

/** The steps that are not done yet, in the guide's own numbers. */
export function missingBrowserSteps(state: BrowserSetupState): number[] {
  const missing: number[] = [];
  if (!state.extensionInstalled) missing.push(1);
  if (state.fileUrls !== true) missing.push(2);
  if (!state.tokenSet) missing.push(5);
  return missing;
}

/**
 * The browser's part of `cc-smart-dev-kit setup`: the state, the guide while something is still
 * missing, and what 0.3.0 left (`legacy.ts`). Read-only for the state (`browserState`): setup
 * never starts a browser, never waits on a person, never fails over it, and never deletes a
 * person's browser data. The ONE fact that comes from this machine rather than from a file under
 * the home folder is 0.3.0's own leftover — its profile folder, and the Chrome it may still have
 * running — so that fact is printed as information, with the command that removes the folder for
 * whoever wants it gone.
 */
export function browserSetupReport(
  paths: CliPaths,
  deps: BrowserSetupDeps,
): {
  info: string[];
  notes: string[];
} {
  const legacy = legacyBrowserInfo(paths, deps);
  const state = browserState(paths, deps);
  const missing = missingBrowserSteps(state);
  // Ready: nothing to say but what 0.3.0 left. Setup names what is missing, never what is fine —
  // and it must never report the browser ready while the token is not saved, so the only other
  // line here is the one below.
  if (missing.length === 0) return { info: legacy, notes: [] };
  return {
    info: [
      ...legacy,
      `  the browser is NOT ready: steps ${missing.join(", ")} of the guide below are still open`,
      ...browserGuideLines(browserGuide(state)),
      `  run \`${COMMAND} browser setup\`: it opens the Chrome window in the "${state.profileDirName}" profile and checks Chrome, the extension and the token`,
    ],
    notes: [],
  };
}

/**
 * What 0.3.0 left, as the information lines setup prints: the same words `doctor`'s lines carry
 * (one home for the sentence, `legacy.ts`), two-space indented like setup's other information.
 */
function legacyBrowserInfo(paths: CliPaths, deps: BrowserSetupDeps): string[] {
  return legacyBrowserFacts(paths, deps).map((fact) => `  ${fact.text}`);
}
