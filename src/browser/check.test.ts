/**
 * `browserCheckCommand` and the prerequisites the live check insists on before it starts anything.
 * The check itself drives the person's own Chrome through the Playwright extension, so it is run by
 * hand (`cc-smart-dev-kit browser check`); everything that DECIDES whether to run it is pure, and
 * tested here.
 */
import { describe, expect, test } from "bun:test";
import { chromeWorld, writeWorldToken } from "../testing/chrome-world";
import { browserCheckCommand, checkPrerequisites, fileUrlHint } from "./check";

describe("browserCheckCommand", () => {
  test("this bun, the plugin's two flags, and this bundle", () => {
    expect(
      browserCheckCommand(
        "/opt/bun/bin/bun",
        "/plugins/cc-smart-dev-kit/dist/cli.js",
        "/plugins/cc-smart-dev-kit",
      ),
    ).toEqual([
      "/opt/bun/bin/bun",
      "--no-env-file",
      "--config=/plugins/cc-smart-dev-kit/bunfig.toml",
      "/plugins/cc-smart-dev-kit/dist/cli.js",
    ]);
  });
});

describe("checkPrerequisites", () => {
  test("everything there: the profile folder is handed back", () => {
    const world = chromeWorld();
    world.withProfile({ fileUrls: true });
    writeWorldToken(world);
    expect(checkPrerequisites(world.paths, world.deps)).toEqual({
      ok: true,
      profileDir: world.profileDir,
    });
  });

  test("each missing piece is named with the command that fixes it", () => {
    const noChrome = chromeWorld({ chrome: false });
    const chromeResult = checkPrerequisites(noChrome.paths, noChrome.deps);
    expect(chromeResult.ok).toBe(false);
    if (!chromeResult.ok) expect(chromeResult.why).toContain("browser setup");

    const noProfile = chromeWorld();
    const profileResult = checkPrerequisites(noProfile.paths, noProfile.deps);
    expect(profileResult.ok).toBe(false);
    if (!profileResult.ok) {
      expect(profileResult.why).toContain('the Chrome profile "claude-code" is not there');
      expect(profileResult.why).toContain("browser setup");
    }

    const noExtension = chromeWorld();
    noExtension.withProfile({ extension: false });
    const extensionResult = checkPrerequisites(noExtension.paths, noExtension.deps);
    expect(extensionResult.ok).toBe(false);
    if (!extensionResult.ok) {
      expect(extensionResult.why).toContain("Playwright extension is not installed");
    }

    const noToken = chromeWorld();
    noToken.withProfile({ fileUrls: true });
    const tokenResult = checkPrerequisites(noToken.paths, noToken.deps);
    expect(tokenResult.ok).toBe(false);
    if (!tokenResult.ok) expect(tokenResult.why).toContain("browser token");
  });
});

describe("fileUrlHint", () => {
  test("it names the profile and the exact switch a failure is fixed with", () => {
    expect(fileUrlHint()).toContain("claude-code");
    expect(fileUrlHint()).toContain("Allow access to file URLs");
    expect(fileUrlHint()).toContain("chrome://extensions/?id=");
  });
});
