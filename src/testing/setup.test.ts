import { describe, expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import * as os from "node:os";
import osDefault, { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { routerPaths } from "../gateway/paths";
import { childEnv, realHomeDir, testHome, testHomeEnv } from "./test-home";

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

describe("the preload's time zone", () => {
  test("TZ holds the zone the tests run in", () => {
    expect(process.env.TZ).toBeDefined();
    expect(process.env.TZ).toBe(zone());
  });

  test("a test that sets TZ and restores it leaves the zone as it found it", () => {
    const zoneBefore = zone();
    const before = process.env.TZ;
    process.env.TZ = "Pacific/Auckland";
    expect(zone()).toBe("Pacific/Auckland");
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
    expect(zone()).toBe(zoneBefore);
  });
});

describe("the preload's home folder", () => {
  test("HOME is the temp home, and CLAUDE_CONFIG_DIR sits under it", () => {
    expect(process.env.HOME).toBe(testHome());
    expect(process.env.HOME).not.toBe(realHomeDir());
    expect(process.env.CLAUDE_CONFIG_DIR).toBe(join(process.env.HOME ?? "", ".claude"));
    expect(process.env.USERPROFILE).toBe(process.env.HOME);
    for (const name of ["XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_DATA_HOME"]) {
      expect(process.env[name]?.startsWith(`${process.env.HOME}/`)).toBe(true);
    }
  });

  test("the temp home still exists in a late test: it lives for the whole run", () => {
    expect(existsSync(testHome())).toBe(true);
    expect(testHome().startsWith(realpathSync(tmpdir()))).toBe(true);
  });

  test("the paths from no env, and from the process env, are not the real home", () => {
    expect(realHomeDir()).not.toBe(testHome());
    expect(cliPaths({}).home).toBe(testHome());
    expect(cliPaths(process.env).home).toBe(testHome());
    expect(cliPaths({}).claudeConfigDir).toBe(join(testHome(), ".claude"));
    expect(routerPaths({}).home).toBe(testHome());
  });

  test("os.homedir() answers the temp home to a module that imports it by name, or as the default", () => {
    expect(homedir()).toBe(testHome());
    expect(os.homedir()).toBe(testHome());
    expect(osDefault.homedir()).toBe(testHome());
    // Every other export of node:os is still there.
    expect(osDefault.tmpdir()).toBe(tmpdir());
    expect(typeof osDefault.platform()).toBe("string");
  });

  test("a child with a hand-built env that has no HOME still starts in the temp home", () => {
    const script = "console.log(process.env.HOME);console.log(require('node:os').homedir())";
    const result = Bun.spawnSync([process.execPath, "-e", script], {
      env: childEnv({ PATH: process.env.PATH ?? "" }),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim().split("\n")).toEqual([testHome(), testHome()]);
  });

  test("childEnv carries the temp home, and the caller's own value wins", () => {
    expect(childEnv({ PATH: "/bin" })).toEqual({ ...testHomeEnv(), PATH: "/bin" });
    expect(childEnv({ HOME: "/elsewhere" }).HOME).toBe("/elsewhere");
    expect(childEnv().CLAUDE_CONFIG_DIR).toBe(join(testHome(), ".claude"));
  });
});

describe("cliPaths refuses an argument that is not an env object", () => {
  // A string has no HOME, so the paths once fell back to the real home folder.
  test("a string, null, an array and a number throw a clear error", () => {
    for (const bad of ["/home/me", null, ["HOME"], 3]) {
      expect(() => cliPaths(bad as never)).toThrow(
        "cliPaths takes an environment object (like process.env)",
      );
    }
  });
});
