/**
 * `doctor`'s lines for the browser, and the same lines on the portal's Browser card.
 *
 * WHAT THEY ANSWER, AND WHY EACH ONE IS HERE
 *   1. Is Google Chrome installed where the launcher expects it?
 *   2. Is the `claude-code` profile there? (The extension mode drives that one profile.)
 *   3. Is the Playwright extension installed in it? (The MCP refuses to connect without it.)
 *   4. Is that profile free of OTHER extensions? A second extension that injects a frame from its
 *      own `chrome-extension://` origin breaks the session (microsoft/playwright#43230, open).
 *   5. Does that profile allow the extension to reach `file://` pages? Read from Chrome's own
 *      record, never written (`chrome.ts` § ALLOW ACCESS TO FILE URLS).
 *   6. Is the token set, in a file only its owner can read? **Never its value.** The token is
 *      REQUIRED: without it the extension asks a person to approve every connection, so
 *      `browser mcp` refuses to start, and a missing token is a ✗ here, not an optional line.
 *
 * The `playwright` server's own registration and start are NOT here: `mcpChecks` (`mcp/doctor.ts`)
 * answers both, and says whether the live server is the plugin's own launcher — one home for that
 * fact, and no line on a page twice.
 *
 * Every failing line names the command or the click that fixes it. Nothing here starts Chrome,
 * reads a page, or touches the network: it is all file checks (the same ones Playwright itself
 * makes before it connects), so `doctor` stays fast and safe to run anywhere.
 */

import { readdirSync, readFileSync } from "node:fs";
import { COMMAND } from "../build-info";
import type { Check } from "../cli/check";
import type { CliPaths } from "../cli/paths";
import type { Runner } from "../gateway/service";
import type { Machine } from "../machine/machine";
import {
  allowsFileUrls,
  type ChromeDeps,
  CLAUDE_CODE_PROFILE,
  chromeCandidates,
  chromeMayBeRunning,
  chromeUserDataDir,
  extensionVersion,
  findChrome,
  findClaudeCodeProfile,
  isExtensionInstalledInProfile,
  otherExtensions,
  PLAYWRIGHT_EXTENSION_SETTINGS_URL,
  PLAYWRIGHT_EXTENSION_URL,
} from "./chrome";
import { legacyBrowserFacts, type ProcessReader } from "./legacy";
import { readBrowserToken, type TokenDeps, tokenProtection } from "./token";

/** One browser line of doctor's report: a check like any other (`check.ts`). */
export type BrowserCheck = Check;

/** What these checks ask of the machine. `platform` and `home` are required; the rest default. */
export interface BrowserDoctorDeps extends ChromeDeps, TokenDeps {
  home: string;
  platform: NodeJS.Platform;
  /**
   * Lists the running processes' command lines, for 0.3.0's leftovers (`legacy.ts`). Default:
   * the real listing for `platform`, through `run`.
   */
  processes?: ProcessReader;
  /** Runs a command and captures its output: macOS's `ps`, Windows' PowerShell. */
  run?: Runner;
}

/** The command that makes a profile, opens the Web Store page and prints the guide. */
const SETUP_COMMAND = `${COMMAND} browser setup`;
/** The command that asks for the token. */
const TOKEN_COMMAND = `${COMMAND} browser token`;

/** One browser line: `group: "browser"` is what the portal draws the Browser card from. */
function line(check: Check): BrowserCheck {
  return { ...check, group: "browser" };
}

/**
 * The machine's own deps, built from a `Machine` and the CLI's paths — one home for both
 * `cc-smart-dev-kit doctor` and the portal's Machine page, so the two judge a machine alike. The
 * file calls are the real ones: every path they touch is under the home folder, which a test
 * points at a temp folder.
 */
export function realBrowserDoctorDeps(
  machine: Pick<Machine, "exists" | "platform" | "run">,
  home: string,
): BrowserDoctorDeps {
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
    readFile: (file) => {
      try {
        return readFileSync(file, "utf8");
      } catch {
        return null;
      }
    },
    run: machine.run,
  };
}

/**
 * The browser's lines. `group: "browser"` marks them so the portal can draw exactly these on
 * the Browser card, and leave them out of the Doctor card's list — one home for each line.
 *
 * The prerequisites first, then what version 0.3.0 left (`legacyChecks`). The leftovers are
 * reported even when the `claude-code` profile is not there yet, which is the usual state of a
 * machine that has just upgraded: that profile is the new setup's own, and it is made later.
 */
export function browserChecks(paths: CliPaths, deps: BrowserDoctorDeps): BrowserCheck[] {
  return [...prerequisiteChecks(paths, deps), ...legacyChecks(paths, deps)];
}

/** The prerequisites: Chrome, the `claude-code` profile, its extension, the token. */
function prerequisiteChecks(paths: CliPaths, deps: BrowserDoctorDeps): BrowserCheck[] {
  const chrome = findChrome(deps);
  if (chrome === null) {
    return [
      line({
        ok: false,
        text: `Google Chrome is not installed where ${COMMAND} looks (${chromeCandidates(deps.platform, deps.home).join(", ")})`,
        fix: `install Google Chrome, then run: ${SETUP_COMMAND}`,
      }),
    ];
  }
  const checks: BrowserCheck[] = [line({ ok: true, text: `Google Chrome is at ${chrome}` })];
  const userDataDir = chromeUserDataDir(deps.platform, deps.home);
  if (userDataDir === null) {
    checks.push(
      line({
        info: true,
        ok: true,
        text: `this system's Chrome profile folder is not one cc-smart-dev-kit knows: the browser's checks stop here (${SETUP_COMMAND} says what to pass)`,
      }),
    );
    return checks;
  }
  const profile = findClaudeCodeProfile(userDataDir, deps);
  if (profile === null) {
    checks.push(
      line({
        ok: false,
        text: `the Chrome profile "${CLAUDE_CODE_PROFILE}" is not in ${userDataDir}`,
        fix: SETUP_COMMAND,
      }),
    );
    return checks;
  }
  const how = profile.found === "directory" ? "its folder" : "the name in Chrome's profile list";
  checks.push(
    line({
      ok: true,
      text: `the Chrome profile "${CLAUDE_CODE_PROFILE}" is at ${profile.dir} (found by ${how})`,
    }),
  );

  // Chrome closed is the state a machine restart leaves, and it is no longer a failure: the first
  // browser call starts Chrome itself (the launcher, `chrome-start.ts`). The same answer the
  // launcher asks, so `doctor` and a session can never disagree about it.
  checks.push(
    chromeMayBeRunning(userDataDir, deps.platform, deps)
      ? line({
          ok: true,
          info: true,
          text: "Google Chrome is running: the browser connects to it",
        })
      : line({
          ok: true,
          info: true,
          text: `Google Chrome is not running: the first browser call starts it in the "${profile.dirName}" profile`,
        }),
  );

  const installed = isExtensionInstalledInProfile(profile.dir, deps);
  const version = installed ? extensionVersion(profile.dir, deps) : null;
  checks.push(
    installed
      ? line({
          ok: true,
          text: `the Playwright extension${version === null ? "" : ` ${version}`} is installed in that profile`,
        })
      : line({
          ok: false,
          text: `the Playwright extension is not installed in the "${CLAUDE_CODE_PROFILE}" profile`,
          fix: `${SETUP_COMMAND}, then click "Add to Chrome" on ${PLAYWRIGHT_EXTENSION_URL}`,
        }),
  );

  // Judged by Chrome's own record, not by the folders on disk: a folder without a manifest
  // (Chrome's `Temp`) and an entry without a folder are not extensions, and Chrome's own
  // components are hidden from `chrome://extensions` and cannot be removed there (live,
  // 2026-10-17: this line named `Temp` and Chrome Web Store Payments, and the person found
  // neither). The line names each one by its manifest name, so it is recognisable.
  const others = otherExtensions(profile.dir, deps);
  checks.push(
    others.length === 0
      ? line({ ok: true, text: "no other extension is in that profile" })
      : line({
          ok: true,
          warn: true,
          text:
            `${String(others.length)} other extension${others.length === 1 ? "" : "s"} in the ` +
            `"${CLAUDE_CODE_PROFILE}" profile (${others.map((one) => `${one.name} [${one.id}]`).join(", ")}): ` +
            `one that injects into pages breaks a browser session (microsoft/playwright#43230, open)`,
          fix: "remove it from that profile: chrome://extensions",
        }),
  );

  if (installed) {
    const fileUrls = allowsFileUrls(profile.dir, deps);
    checks.push(
      fileUrls === true
        ? line({ ok: true, text: "that profile lets the extension open file:// pages" })
        : fileUrls === false
          ? line({
              ok: false,
              text: `the "${CLAUDE_CODE_PROFILE}" profile does not let the extension open file:// pages`,
              fix: `open ${PLAYWRIGHT_EXTENSION_SETTINGS_URL} in that profile and switch on "Allow access to file URLs"`,
            })
          : line({
              info: true,
              ok: true,
              text:
                `cannot read the profile's Preferences to check the file:// setting: open ` +
                `${PLAYWRIGHT_EXTENSION_SETTINGS_URL} in that profile and make sure "Allow access ` +
                `to file URLs" is on`,
            }),
    );
  }

  const token = readBrowserToken(paths, deps, deps.platform);
  checks.push(
    token.source === "file"
      ? line({
          ok: true,
          text: `the browser token is set (${paths.browserTokenFile}, ${tokenProtection(deps.platform)})`,
        })
      : line({
          ok: false,
          text: `the browser token is not set, so the browser cannot connect (${token.reason})`,
          fix: `${SETUP_COMMAND}, then ${TOKEN_COMMAND}`,
        }),
  );
  // The `playwright` server's own registration and start are `mcpChecks`' lines (`mcp/doctor.ts`):
  // they already say whether the live server is the plugin's own launcher, so these lines stop at
  // the browser's own prerequisites — one home for each fact.
  return checks;
}

/**
 * What 0.3.0 left behind (`legacy.ts`): its shared profile still on disk (a warning — it may hold
 * sign-ins, and deleting it is the person's own call), the old detached Chrome while it still
 * runs (`!`, its debug port is open to every program on this machine), and `·` when the process
 * list could not be read, so the answer is unknown rather than "nothing is running".
 */
function legacyChecks(paths: CliPaths, deps: BrowserDoctorDeps): BrowserCheck[] {
  return legacyBrowserFacts(paths, deps).map((fact) =>
    fact.kind === "warn"
      ? line({ ok: true, text: fact.text, warn: true })
      : line({ info: true, ok: true, text: fact.text }),
  );
}
