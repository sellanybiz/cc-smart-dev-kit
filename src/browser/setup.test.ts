/**
 * `browser setup` (`setup.ts`): finding Chrome, making the `claude-code` profile, the per-user
 * pre-registration on macOS and Windows, the one write inside Chrome's own folder (the profile's
 * display name, and only while no Chrome runs), the guide, `--dry-run`, and what `restore` takes
 * back. No Chrome is started anywhere in this file: `spawnDetached` records the call.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { readChanged } from "../setup/write";
import { type ChromeWorld, chromeWorld, writeWorldToken } from "../testing/chrome-world";
import { PLAYWRIGHT_EXTENSION_SETTINGS_URL, PLAYWRIGHT_EXTENSION_URL } from "./chrome";
import { legacyBrowserPaths } from "./legacy";
import {
  browserRestoreLines,
  browserSetup,
  browserSetupReport,
  missingBrowserSteps,
} from "./setup";

describe("browser setup", () => {
  test("no Chrome: one note naming where it looked, and nothing else", () => {
    const world = chromeWorld({ chrome: false });
    const result = browserSetup(world.paths, world.deps, { apply: true });
    expect(result.ok).toBe(false);
    expect(result.guide).toEqual([]);
    expect(result.notes.join("\n")).toContain("Google Chrome is not installed");
    expect(result.notes.join("\n")).toContain("browser setup");
    expect(world.detached).toEqual([]);
  });

  test("first run: Chrome is opened on the Web Store page in the new profile, and the guide follows", () => {
    const world = chromeWorld();
    const result = browserSetup(world.paths, world.deps, { apply: true });
    expect(result.ok).toBe(true);
    expect(world.detached).toEqual([
      [
        world.chrome,
        "--profile-directory=claude-code",
        "--new-window",
        PLAYWRIGHT_EXTENSION_URL,
      ].join(" "),
    ]);
    expect(result.changes.join("\n")).toContain(`--profile-directory=claude-code`);
    expect(result.info.join("\n")).toContain(
      'Chrome makes the "claude-code" profile on this launch',
    );
    // Nothing is installed and nothing is claimed ready.
    expect(result.state.extensionInstalled).toBe(false);
    expect(result.state.tokenSet).toBe(false);
    expect(missingBrowserSteps(result.state)).toEqual([1, 2, 5]);
    // The guide is the same five steps everywhere, and step 2 names the address to paste.
    expect(result.guide.join("\n")).toContain(PLAYWRIGHT_EXTENSION_SETTINGS_URL);
    expect(result.guide.filter((line) => /^\d\./.test(line))).toHaveLength(5);
  });

  test("a profile with the extension, file URLs on and a token: the name is the only change, once", () => {
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    writeWorldToken(world);
    const first = browserSetup(world.paths, world.deps, { apply: true });
    // No page is opened, and the one thing written is the profile's display name.
    expect(world.detached).toEqual([]);
    expect(first.changes).toHaveLength(1);
    expect(first.changes[0]).toContain("profile.info_cache.claude-code.name");

    // A second run changes nothing at all: the name is right by then.
    const second = browserSetup(world.paths, world.deps, { apply: true });
    expect(second.changes).toEqual([]);
    expect(second.ok).toBe(true);
    expect(second.state).toEqual({
      extensionInstalled: true,
      fileUrls: true,
      profile: true,
      profileDirName: "claude-code",
      tokenSet: true,
    });
    expect(missingBrowserSteps(second.state)).toEqual([]);
    // The three checkable steps say done; pinning and copying can only be done by hand.
    expect(second.guide.filter((line) => line.includes("(done)"))).toHaveLength(3);
    expect(second.guide.filter((line) => line.includes("(by hand)"))).toHaveLength(2);
  });

  test("--dry-run: the same lines, and nothing run or written", () => {
    const world = chromeWorld();
    const result = browserSetup(world.paths, world.deps, { apply: false });
    expect(result.changes.join("\n")).toContain("--new-window");
    expect(world.detached).toEqual([]);
    expect(existsSync(world.profileDir)).toBe(false);
  });

  test("the profile's display name is written through the managed helpers, so restore can undo it", () => {
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    const result = browserSetup(world.paths, world.deps, { apply: true });
    const localState = join(world.userDataDir, "Local State");
    expect(
      JSON.parse(readFileSync(localState, "utf8")).profile.info_cache["claude-code"].name,
    ).toBe("claude-code");
    expect(result.changes.join("\n")).toContain("profile.info_cache.claude-code.name");
    // The change is recorded: `restore` knows the file and the key it owns.
    expect(Object.keys(readChanged(world.paths.stateDir))).toContain(localState);
    // And the profile itself is untouched: its Preferences are still Chrome's own file.
    expect(existsSync(join(world.profileDir, "Preferences"))).toBe(true);
  });

  test("Chrome running: the name is left alone, and the line says how to rename it", () => {
    const world = chromeWorld({ lock: `${hostname()}-${String(process.pid)}` });
    world.withProfile({ fileUrls: true });
    const result = browserSetup(world.paths, world.deps, { apply: true });
    const localState = join(world.userDataDir, "Local State");
    expect(
      JSON.parse(readFileSync(localState, "utf8")).profile.info_cache["claude-code"].name,
    ).toBe("Person 1");
    expect(result.info.join("\n")).toContain("Chrome is running");
    expect(result.info.join("\n")).toContain("Customize profile");
  });

  test("a profile with the extension missing is opened on the Web Store page again", () => {
    const world = chromeWorld();
    world.withProfile({ extension: false, fileUrls: true });
    writeWorldToken(world);
    const result = browserSetup(world.paths, world.deps, { apply: true });
    expect(world.detached).toHaveLength(1);
    expect(result.state.extensionInstalled).toBe(false);
    // Step 2 is open too: the file-URL switch cannot be on while there is no extension.
    expect(missingBrowserSteps(result.state)).toEqual([1, 2]);
  });

  test("another extension in that profile is a note naming the open upstream bug", () => {
    const world = chromeWorld();
    world.withProfile({ fileUrls: true, others: ["aaaaother"] });
    const result = browserSetup(world.paths, world.deps, { apply: false });
    expect(result.notes.join("\n")).toContain("aaaaother");
    expect(result.notes.join("\n")).toContain("playwright#43230");
  });
});

describe("macOS: the per-user pre-registration", () => {
  test("the External Extensions file is written once, and a second run leaves it alone", () => {
    const world = chromeWorld({ platform: "darwin" });
    world.withProfile({ fileUrls: true });
    const file = join(
      world.home,
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "External Extensions",
      "mmlmfjhmonkocbjadbfplnigmagldckm.json",
    );
    const first = browserSetup(world.paths, world.deps, { apply: true });
    expect(first.changes.join("\n")).toContain("External Extensions");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      external_update_url: "https://clients2.google.com/service/update2/crx",
    });
    const second = browserSetup(world.paths, world.deps, { apply: true });
    expect(second.changes).toEqual([]);
    expect(second.info.join("\n")).toContain("pre-registered for this user already");
  });
});

describe("Windows: the HKCU pre-registration", () => {
  test("added once, recorded for restore, and not added again", () => {
    const world = chromeWorld({ platform: "win32" });
    // `reg query` finds nothing (exit 1), then `reg add` succeeds.
    world.answer("query", { exitCode: 1, output: "" });
    world.answer("add", { exitCode: 0, output: "" });
    const first = browserSetup(world.paths, world.deps, { apply: true });
    expect(world.runs.some((line) => line.startsWith("reg add"))).toBe(true);
    expect(first.changes.join("\n")).toContain("HKCU");
    const record = readFileSync(join(world.paths.stateDir, "browser-setup.json"), "utf8");
    expect(JSON.parse(record)).toEqual({ windowsExtensionKey: true });

    // The key is there now: the query answers with our own update_url, so nothing is added.
    world.answer("query", {
      exitCode: 0,
      output: "    update_url    REG_SZ    https://clients2.google.com/service/update2/crx",
    });
    const second = browserSetup(world.paths, world.deps, { apply: true });
    expect(second.info.join("\n")).toContain("pre-registered for this user already");
    expect(world.runs.filter((line) => line.startsWith("reg add"))).toHaveLength(1);
  });

  test("a registry that cannot be written is one note, and setup carries on", () => {
    const world = chromeWorld({ platform: "win32" });
    world.answer("query", { exitCode: 1, output: "" });
    world.answer("add", { exitCode: 1, output: "ERROR: Access is denied." });
    const result = browserSetup(world.paths, world.deps, { apply: true });
    expect(result.ok).toBe(true);
    expect(result.notes.join("\n")).toContain("could not be pre-registered");
    expect(existsSync(join(world.paths.stateDir, "browser-setup.json"))).toBe(false);
  });
});

describe("restore takes the browser's own things back", () => {
  test("the token file, and the Windows key only while it still holds our URL", () => {
    const world = chromeWorld({ platform: "win32" });
    writeWorldToken(world);
    world.answer("query", {
      exitCode: 0,
      output: "    update_url    REG_SZ    https://clients2.google.com/service/update2/crx",
    });
    world.answer("delete", { exitCode: 0, output: "" });
    const lines = browserRestoreLines(world.paths, {
      record: { windowsExtensionKey: true },
      run: world.deps.run,
    });
    expect(lines.lines.join("\n")).toContain("the browser token");
    expect(lines.lines.join("\n")).toContain("the extension pre-registration");
    expect(world.runs.some((line) => line.startsWith("reg delete"))).toBe(true);
    expect(existsSync(world.paths.browserTokenFile)).toBe(false);
    expect(lines.profileTouched).toBe(true);
  });

  test("a key the person changed since is left alone, and nothing claims to have touched it", () => {
    const world = chromeWorld({ platform: "win32" });
    world.answer("query", {
      exitCode: 0,
      output: "    update_url    REG_SZ    https://example.com/other",
    });
    const lines = browserRestoreLines(world.paths, {
      record: { windowsExtensionKey: true },
      run: world.deps.run,
    });
    expect(world.runs.some((line) => line.startsWith("reg delete"))).toBe(false);
    expect(lines.lines).toEqual([]);
  });

  test("nothing of the browser's is there: no lines at all", () => {
    const world = chromeWorld();
    const lines = browserRestoreLines(world.paths, {
      record: {},
      run: world.deps.run,
    });
    expect(lines).toEqual({ lines: [], profileTouched: false });
  });
});

describe("what cc-smart-dev-kit setup prints", () => {
  test("not ready: the state, how many steps are open, and the guide", () => {
    const world = chromeWorld();
    const report = browserSetupReport(world.paths, world.deps);
    expect(report.notes).toEqual([]);
    expect(report.info.join("\n")).toContain("the browser is NOT ready: steps 1, 2, 5");
    expect(report.info.join("\n")).toContain("browser setup");
    expect(report.info.join("\n")).toContain(PLAYWRIGHT_EXTENSION_SETTINGS_URL);
    expect(world.detached).toEqual([]);
  });

  test("ready: nothing to say at all", () => {
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    writeWorldToken(world);
    expect(browserSetupReport(world.paths, world.deps)).toEqual({ info: [], notes: [] });
  });

  test("the same lines on a machine whose Chrome cannot be found: no host fact leaks in", () => {
    // The report reads the profile and the token under the home folder, never Chrome's
    // executable, so a machine without Chrome prints exactly the same lines.
    const without = chromeWorld({ chrome: false });
    const with_ = chromeWorld();
    expect(browserSetupReport(without.paths, without.deps)).toEqual(
      browserSetupReport(with_.paths, with_.deps),
    );
  });
});

describe("the one write inside Chrome's own folder", () => {
  test("Local State keeps every other key, and the profile's own mode is unchanged", () => {
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    const localState = join(world.userDataDir, "Local State");
    const before = JSON.parse(readFileSync(localState, "utf8"));
    before.profile.last_used = "claude-code";
    before.some_other_setting = { keep: true };
    writeFileSync(localState, JSON.stringify(before));
    const mode = statSync(localState).mode & 0o777;
    browserSetup(world.paths, world.deps, { apply: true });
    const after = JSON.parse(readFileSync(localState, "utf8"));
    expect(after.some_other_setting).toEqual({ keep: true });
    expect(after.profile.last_used).toBe("claude-code");
    expect(after.profile.info_cache["claude-code"].name).toBe("claude-code");
    expect(statSync(localState).mode & 0o777).toBe(mode);
    // The plugin never deletes Chrome's files.
    rmSync(join(world.userDataDir, "Local State"), { force: true });
  });
});

/** 0.3.0's profile folder with a cookie in it, and its picker beside it. */
function leftover(world: ChromeWorld): { picker: string; profile: string } {
  const { picker, profile } = legacyBrowserPaths(world.paths);
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, "Cookies"), "a signed-in cookie");
  writeFileSync(picker, "// 0.3.0's init page\n");
  return { picker, profile };
}

/** Nothing here may ever delete or change what 0.3.0 left: it may hold the person's sign-ins. */
function untouched(profile: string, picker: string): void {
  expect(readFileSync(join(profile, "Cookies"), "utf8")).toBe("a signed-in cookie");
  expect(readFileSync(picker, "utf8")).toBe("// 0.3.0's init page\n");
}

describe("what 0.3.0 left behind", () => {
  test("browser setup prints it as information, changes nothing, and deletes nothing", () => {
    const world = chromeWorld();
    const { picker, profile } = leftover(world);
    const result = browserSetup(
      world.paths,
      { ...world.deps, processes: () => [] },
      {
        apply: true,
      },
    );
    const info = result.info.join("\n");
    expect(info).toContain("0.3.0 shared browser's profile is still at");
    expect(info).toContain("Delete them yourself when you no longer need the sign-ins");
    // It is information: no question, no note, and no change line mentions it.
    expect(result.notes.join("\n")).not.toContain("0.3.0");
    expect(result.changes.join("\n")).not.toContain(profile);
    untouched(profile, picker);
  });

  test("cc-smart-dev-kit setup prints the same lines, and still says the browser is ready", () => {
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    writeWorldToken(world);
    const { picker, profile } = leftover(world);
    const report = browserSetupReport(world.paths, { ...world.deps, processes: () => [] });
    expect(report.notes).toEqual([]);
    expect(report.info.join("\n")).toContain("0.3.0 shared browser's profile is still at");
    // 0.4.0's own setup is complete, so nothing about it is printed: one home for each line.
    expect(report.info.join("\n")).not.toContain("NOT ready");
    untouched(profile, picker);
  });

  test("the old Chrome while it still runs is named by setup too", () => {
    const world = chromeWorld();
    const { picker, profile } = leftover(world);
    const report = browserSetupReport(world.paths, {
      ...world.deps,
      processes: () => [
        { command: `/opt/google/chrome/chrome --user-data-dir=${profile} about:blank`, pid: 4321 },
      ],
    });
    expect(report.info.join("\n")).toContain("the 0.3.0 shared Chrome is still running");
    expect(report.info.join("\n")).toContain("pid 4321");
    expect(report.info.join("\n")).toContain("Its debug port has no password");
    untouched(profile, picker);
  });

  test("a machine that never ran 0.3.0's browser says nothing at all", () => {
    const world = chromeWorld();
    const result = browserSetup(
      world.paths,
      { ...world.deps, processes: () => [] },
      {
        apply: false,
      },
    );
    expect(result.info.join("\n")).not.toContain("0.3.0");
  });
});
