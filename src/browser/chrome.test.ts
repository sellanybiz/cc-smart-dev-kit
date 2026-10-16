/**
 * Finding the person's Chrome, its profile folder, the `claude-code` profile, and what is in it —
 * the file checks Playwright itself makes before it connects, and the one Chrome-only switch
 * ("Allow access to file URLs"). No Chrome is started anywhere in this file.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
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
  otherExtensionIds,
  PLAYWRIGHT_EXTENSION_ID,
} from "./chrome";

/** A profile folder with the Playwright extension unpacked into it. */
function profileWithExtension(root: string, name = CLAUDE_CODE_PROFILE, version = "0.4.0"): string {
  const dir = join(root, name);
  mkdirSync(join(dir, "Extensions", PLAYWRIGHT_EXTENSION_ID, version), { recursive: true });
  return dir;
}

/** Preferences as Chrome writes them for an installed extension. */
function preferences(record: Record<string, unknown>): string {
  return JSON.stringify({ extensions: { settings: { [PLAYWRIGHT_EXTENSION_ID]: record } } });
}

describe("findChrome", () => {
  test("the platform's own places, in order; null when none is there", () => {
    expect(chromeCandidates("linux", "/home/user")).toEqual([
      "/opt/google/chrome/chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
    ]);
    expect(findChrome({ exists: () => false, home: "/home/user", platform: "linux" })).toBeNull();
    expect(
      findChrome({
        exists: (path) => path === "/usr/bin/google-chrome-stable",
        home: "/home/user",
        platform: "linux",
      }),
    ).toBe("/usr/bin/google-chrome-stable");
    expect(chromeCandidates("darwin", "/Users/user")).toEqual([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]);
    // Windows: the two machine-wide installs, then a Chrome installed for one user.
    expect(chromeCandidates("win32", "C:\\Users\\user")).toEqual([
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Users\\user\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
    ]);
  });
});

describe("chromeUserDataDir", () => {
  test("the folder each OS keeps every profile in", () => {
    expect(chromeUserDataDir("linux", "/home/user")).toBe("/home/user/.config/google-chrome");
    expect(chromeUserDataDir("darwin", "/Users/user")).toBe(
      "/Users/user/Library/Application Support/Google/Chrome",
    );
    expect(chromeUserDataDir("win32", "C:\\Users\\user")).toBe(
      "C:\\Users\\user\\AppData\\Local\\Google\\Chrome\\User Data",
    );
  });
});

describe("findClaudeCodeProfile", () => {
  test("the folder named claude-code wins, and its display name comes from Local State", () => {
    const root = tempDir("chrome");
    profileWithExtension(root);
    writeFileSync(
      join(root, "Local State"),
      JSON.stringify({ profile: { info_cache: { [CLAUDE_CODE_PROFILE]: { name: "Person 1" } } } }),
    );
    const found = findClaudeCodeProfile(root);
    expect(found).toEqual({
      dir: join(root, CLAUDE_CODE_PROFILE),
      dirName: CLAUDE_CODE_PROFILE,
      displayName: "Person 1",
      found: "directory",
    });
  });

  test("a profile NAMED claude-code is used by its own directory name", () => {
    const root = tempDir("chrome");
    const dir = join(root, "Profile 1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(root, "Local State"),
      JSON.stringify({ profile: { info_cache: { "Profile 1": { name: CLAUDE_CODE_PROFILE } } } }),
    );
    const found = findClaudeCodeProfile(root);
    expect(found).toEqual({
      dir,
      dirName: "Profile 1",
      displayName: CLAUDE_CODE_PROFILE,
      found: "local-state",
    });
  });

  test("nothing there, or a name whose folder is gone: null", () => {
    const root = tempDir("chrome");
    expect(findClaudeCodeProfile(root)).toBeNull();
    writeFileSync(
      join(root, "Local State"),
      JSON.stringify({ profile: { info_cache: { "Profile 2": { name: CLAUDE_CODE_PROFILE } } } }),
    );
    expect(findClaudeCodeProfile(root)).toBeNull();
  });

  test("a Local State that does not parse is not fatal: the folder still answers", () => {
    const root = tempDir("chrome");
    profileWithExtension(root);
    writeFileSync(join(root, "Local State"), "{not json");
    expect(findClaudeCodeProfile(root)?.dirName).toBe(CLAUDE_CODE_PROFILE);
  });
});

describe("the extension in a profile", () => {
  test("the unpacked folder counts, and its version is the newest one there", () => {
    const root = tempDir("chrome");
    const dir = profileWithExtension(root, CLAUDE_CODE_PROFILE, "0.3.0");
    mkdirSync(join(dir, "Extensions", PLAYWRIGHT_EXTENSION_ID, "0.4.0"), { recursive: true });
    expect(isExtensionInstalledInProfile(dir)).toBe(true);
    expect(extensionVersion(dir)).toBe("0.4.0");
  });

  test("a populated Preferences record counts; an empty one (an uninstall) does not", () => {
    const dir = tempDir("chrome");
    writeFileSync(join(dir, "Preferences"), preferences({ state: 1 }));
    expect(isExtensionInstalledInProfile(dir)).toBe(true);
    writeFileSync(join(dir, "Preferences"), preferences({}));
    expect(isExtensionInstalledInProfile(dir)).toBe(false);
  });

  test("every other extension is named, and the Playwright one is not", () => {
    const dir = tempDir("chrome");
    mkdirSync(join(dir, "Extensions", PLAYWRIGHT_EXTENSION_ID), { recursive: true });
    mkdirSync(join(dir, "Extensions", "aaaaother"), { recursive: true });
    expect(otherExtensionIds(dir)).toEqual(["aaaaother"]);
  });
});

describe("allowsFileUrls", () => {
  test("on: the flag Chrome keeps for the extension", () => {
    const dir = tempDir("chrome");
    writeFileSync(join(dir, "Preferences"), preferences({ newAllowFileAccess: true }));
    expect(allowsFileUrls(dir)).toBe(true);
  });

  test("off: the record is there and the flag is not", () => {
    const dir = tempDir("chrome");
    writeFileSync(join(dir, "Preferences"), preferences({ newAllowFileAccess: false }));
    expect(allowsFileUrls(dir)).toBe(false);
  });

  test("the pre-rename key is read too, and Secure Preferences is read as well", () => {
    const dir = tempDir("chrome");
    writeFileSync(join(dir, "Preferences"), preferences({ state: 1 }));
    writeFileSync(join(dir, "Secure Preferences"), preferences({ allowFileAccess: true }));
    expect(allowsFileUrls(dir)).toBe(true);
  });

  test("no Preferences file at all: null, so nothing is claimed", () => {
    expect(allowsFileUrls(tempDir("chrome"))).toBeNull();
  });
});

describe("chromeMayBeRunning", () => {
  test("no lock: no Chrome", () => {
    const root = tempDir("chrome");
    expect(chromeMayBeRunning(root, "linux")).toBe(false);
    expect(chromeMayBeRunning(root, "darwin")).toBe(false);
  });

  test("a lock naming this machine and a pid that is gone is a leftover: not running", () => {
    const root = tempDir("chrome");
    const deps: ChromeDeps = {
      hostname: () => "this-host",
      isAlive: () => false,
      readlink: () => "this-host-999999",
    };
    expect(chromeMayBeRunning(root, "linux", deps)).toBe(false);
  });

  test("a live holder, and a lock from another machine: both read as running", () => {
    const root = tempDir("chrome");
    expect(
      chromeMayBeRunning(root, "linux", {
        hostname: () => "this-host",
        isAlive: () => true,
        readlink: () => "this-host-1234",
      }),
    ).toBe(true);
    expect(
      chromeMayBeRunning(root, "linux", {
        hostname: () => "this-host",
        isAlive: () => false,
        readlink: () => "another-host-1234",
      }),
    ).toBe(true);
  });

  test("Windows: the profile's lockfile, open or gone", () => {
    const root = tempDir("chrome");
    expect(
      chromeMayBeRunning(root, "win32", {
        openLockfile: () => undefined,
      }),
    ).toBe(false);
    const busy = new Error("busy") as Error & { code: string };
    busy.code = "EBUSY";
    expect(
      chromeMayBeRunning(root, "win32", {
        openLockfile: () => {
          throw busy;
        },
      }),
    ).toBe(true);
    const gone = new Error("gone") as Error & { code: string };
    gone.code = "ENOENT";
    expect(
      chromeMayBeRunning(root, "win32", {
        openLockfile: () => {
          throw gone;
        },
      }),
    ).toBe(false);
  });
});

describe("the real checks against a real temp profile", () => {
  test("a folder with the extension and the flag is read end to end", () => {
    const root = tempDir("chrome");
    const dir = profileWithExtension(root);
    writeFileSync(join(dir, "Preferences"), preferences({ newAllowFileAccess: true }));
    chmodSync(join(dir, "Preferences"), 0o600);
    expect(isExtensionInstalledInProfile(dir)).toBe(true);
    expect(allowsFileUrls(dir)).toBe(true);
    expect(findClaudeCodeProfile(root)?.dir).toBe(dir);
  });
});
