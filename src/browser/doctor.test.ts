/**
 * The browser's lines in `doctor` (`doctor.ts`): Chrome, the `claude-code` profile, the extension in
 * it, other extensions, the file-URL switch, the token — and the one thing every line must never
 * carry: the token's value. All of it is file checks; nothing here starts Chrome. The last group
 * is what version 0.3.0 left behind (`legacy.ts`), which nothing here deletes either.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tildify } from "../cli/paths";
import { type ChromeWorld, chromeWorld, writeWorldToken } from "../testing/chrome-world";
import { PLAYWRIGHT_EXTENSION_SETTINGS_URL, PLAYWRIGHT_EXTENSION_URL } from "./chrome";
import { browserChecks } from "./doctor";
import { legacyBrowserPaths } from "./legacy";

const texts = (checks: ReturnType<typeof browserChecks>) =>
  checks.map((check) => check.text).join("\n");

describe("browserChecks", () => {
  test("every line belongs to the browser's own card", () => {
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    writeWorldToken(world);
    const checks = browserChecks(world.paths, world.deps);
    expect(checks.length).toBeGreaterThan(4);
    expect(checks.every((check) => check.section === "browser")).toBe(true);
  });

  test("no Chrome: one failing line, naming where it looked and what to run", () => {
    const world = chromeWorld({ chrome: false });
    const checks = browserChecks(world.paths, world.deps);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.ok).toBe(false);
    expect(checks[0]?.text).toContain("Google Chrome is not installed");
    expect(checks[0]?.text).toContain("browser setup");
  });

  test("no profile: a failing line whose fix is the setup command", () => {
    const world = chromeWorld();
    const checks = browserChecks(world.paths, world.deps);
    expect(checks).toHaveLength(2);
    expect(checks[1]?.ok).toBe(false);
    expect(checks[1]?.text).toContain('the Chrome profile "claude-code" is not in');
    expect(checks[1]?.text).toContain("browser setup");
  });

  test("no extension in the profile: the line names the Web Store page", () => {
    const world = chromeWorld();
    world.withProfile({ extension: false });
    const checks = browserChecks(world.paths, world.deps);
    const line = checks.find((check) => check.text.includes("Playwright extension"));
    expect(line?.ok).toBe(false);
    expect(line?.text).toContain(PLAYWRIGHT_EXTENSION_URL);
  });

  test("another extension in the profile: a warning naming the open upstream bug", () => {
    const world = chromeWorld();
    world.withProfile({ fileUrls: true, others: ["aaaaother"] });
    const checks = browserChecks(world.paths, world.deps);
    const line = checks.find((check) => check.text.includes("other extension"));
    expect(line?.warn).toBe(true);
    expect(line?.ok).toBe(true);
    expect(line?.text).toContain("aaaaother");
    expect(line?.text).toContain("playwright#43230");
  });

  test("the file-URL switch: off fails with the address, on passes, unreadable says so", () => {
    const off = chromeWorld();
    off.withProfile({ fileUrls: false });
    const offLine = browserChecks(off.paths, off.deps).find((check) =>
      check.text.includes("file://"),
    );
    expect(offLine?.ok).toBe(false);
    expect(offLine?.text).toContain(PLAYWRIGHT_EXTENSION_SETTINGS_URL);
    expect(offLine?.text).toContain("Allow access to file URLs");

    const on = chromeWorld();
    on.withProfile({ fileUrls: true });
    const onLine = browserChecks(on.paths, on.deps).find((check) => check.text.includes("file://"));
    expect(onLine?.ok).toBe(true);

    // A profile whose Preferences cannot be read: nothing is claimed, and the address is named.
    const noPrefs = chromeWorld();
    noPrefs.withProfile({ fileUrls: true });
    const unreadable = browserChecks(noPrefs.paths, {
      ...noPrefs.deps,
      readFile: () => null,
    }).find((check) => check.text.includes("file://"));
    expect(unreadable?.info).toBe(true);
    expect(unreadable?.text).toContain("cannot read the profile's Preferences");
    expect(unreadable?.text).toContain(PLAYWRIGHT_EXTENSION_SETTINGS_URL);
  });

  test("no token: a failing line with the fix, and the token's value never appears", () => {
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    const missing = browserChecks(world.paths, world.deps).find((check) =>
      check.text.includes("token"),
    );
    expect(missing?.ok).toBe(false);
    expect(missing?.text).toContain("browser token");
    expect(missing?.text).toContain("browser setup");

    const token = `${"A".repeat(40)}_-b`;
    writeWorldToken(world, token);
    const checks = browserChecks(world.paths, world.deps);
    const set = checks.find((check) => check.text.includes("the browser token is set"));
    expect(set?.ok).toBe(true);
    expect(set?.text).toContain(world.paths.browserTokenFile);
    expect(set?.text).toContain("mode 600");
    expect(texts(checks)).not.toContain(token);
  });

  test("a token file others can read fails, with the command that fixes it", () => {
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    writeWorldToken(world);
    const checks = browserChecks(world.paths, {
      ...world.deps,
      read: () => ({ mode: 0o644, text: "A".repeat(43) }),
    });
    const line = checks.find((check) => check.text.includes("token"));
    expect(line?.ok).toBe(false);
    expect(line?.text).toContain("readable by others");
  });
});

/** 0.3.0's profile folder with a cookie in it: the sign-ins the lines warn about. */
function leftover(world: ChromeWorld): { picker: string; profile: string } {
  const { picker, profile } = legacyBrowserPaths(world.paths);
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, "Cookies"), "a signed-in cookie");
  writeFileSync(picker, "// 0.3.0's init page\n");
  return { picker, profile };
}

/** Nothing here may ever delete or change what 0.3.0 left. */
function untouched(profile: string, picker: string): void {
  expect(readFileSync(join(profile, "Cookies"), "utf8")).toBe("a signed-in cookie");
  expect(readFileSync(picker, "utf8")).toBe("// 0.3.0's init page\n");
}

describe("what 0.3.0 left behind", () => {
  test("the old shared profile: a warning naming the paths and the command that removes them", () => {
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    writeWorldToken(world);
    const { picker, profile } = leftover(world);
    const checks = browserChecks(world.paths, { ...world.deps, processes: () => [] });
    const line = checks.find((check) => check.text.includes("0.3.0 shared browser's profile"));
    expect(line?.warn).toBe(true);
    expect(line?.ok).toBe(true); // a warning is never a failure: doctor still exits 0
    expect(line?.section).toBe("browser");
    expect(line?.text).toContain(
      `is still at ${tildify(profile, world.home)} and may hold sign-ins`,
    );
    expect(line?.text).toContain(`its file picker is at ${tildify(picker, world.home)}`);
    expect(line?.text).toContain(
      `rm -rf ${tildify(profile, world.home)} ${tildify(picker, world.home)}`,
    );
    expect(line?.text).toContain("Delete them yourself when you no longer need the sign-ins");
    untouched(profile, picker);
  });

  test("the line is there on a machine that has not made the claude-code profile yet", () => {
    // The usual state just after an upgrade: 0.3.0's leftovers, and none of 0.4.0's setup.
    const world = chromeWorld();
    const { picker, profile } = leftover(world);
    const checks = browserChecks(world.paths, { ...world.deps, processes: () => [] });
    expect(checks.some((check) => check.ok === false)).toBe(true); // no profile yet: ✗
    expect(checks.some((check) => check.text.includes("0.3.0 shared browser's profile"))).toBe(
      true,
    );
    untouched(profile, picker);
  });

  test("the old Chrome still running: a warning naming the pid", () => {
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    writeWorldToken(world);
    const { picker, profile } = leftover(world);
    const checks = browserChecks(world.paths, {
      ...world.deps,
      processes: () => [
        { command: `/opt/google/chrome/chrome --user-data-dir=${profile} about:blank`, pid: 1234 },
        {
          command: `/opt/google/chrome/chrome --type=renderer --user-data-dir=${profile}`,
          pid: 1235,
        },
      ],
    });
    const line = checks.find((check) => check.text.includes("still running"));
    expect(line?.warn).toBe(true);
    expect(line?.ok).toBe(true);
    expect(line?.text).toContain("pid 1234");
    expect(line?.text).not.toContain("1235");
    expect(line?.text).toContain("Its debug port has no password");
    untouched(profile, picker);
  });

  test("a process list that could not be read: '·' information, never a claim of none", () => {
    const world = chromeWorld();
    const { picker, profile } = leftover(world);
    const checks = browserChecks(world.paths, { ...world.deps, processes: () => null });
    const line = checks.find((check) => check.text.includes("process list"));
    expect(line?.info).toBe(true);
    expect(line?.ok).toBe(true); // information, never a failure
    expect(line?.text).toContain("is unknown");
    expect(line?.text).not.toContain("nothing is running");
    untouched(profile, picker);
  });

  test("no trace of 0.3.0: not one line", () => {
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    writeWorldToken(world);
    const checks = browserChecks(world.paths, { ...world.deps, processes: () => [] });
    expect(texts(checks)).not.toContain("0.3.0");
    expect(existsSync(legacyBrowserPaths(world.paths).profile)).toBe(false);
  });
});
