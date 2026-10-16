/**
 * The browser's lines in `doctor` (`doctor.ts`): Chrome, the `claude-code` profile, the extension in
 * it, other extensions, the file-URL switch, the token — and the one thing every line must never
 * carry: the token's value. All of it is file checks; nothing here starts Chrome.
 */
import { describe, expect, test } from "bun:test";
import { chromeWorld, writeWorldToken } from "../testing/chrome-world";
import { PLAYWRIGHT_EXTENSION_SETTINGS_URL, PLAYWRIGHT_EXTENSION_URL } from "./chrome";
import { browserChecks } from "./doctor";

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

    const token = "A".repeat(40) + "_-b";
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
