import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { routerPaths } from "../gateway/paths";
import { TEST_HOST_VAR } from "../machine/host";
import { cliPaths } from "./paths";

/** A Windows run, as `Machine` sees it: the platform comes from the same variable. */
const WINDOWS = { [TEST_HOST_VAR]: JSON.stringify({ platform: "win32" }) };
const USERPROFILE = "C:\\Users\\me";

describe("the home folder", () => {
  test("a Windows run reads USERPROFILE when HOME is not set (Bun leaves HOME undefined there)", () => {
    expect(cliPaths({ ...WINDOWS, USERPROFILE }).home).toBe(USERPROFILE);
    expect(routerPaths({ ...WINDOWS, USERPROFILE }).home).toBe(USERPROFILE);
  });

  test("under Git Bash HOME is set, and it wins: one folder for Git Bash, PowerShell and the CLI", () => {
    expect(cliPaths({ ...WINDOWS, HOME: "/home/me", USERPROFILE }).home).toBe("/home/me");
  });

  test("off Windows USERPROFILE changes nothing, HOME or not", () => {
    // No platform given: this machine's own, which is what a Linux or macOS run has.
    expect(cliPaths({ USERPROFILE }).home).toBe(homedir());
    expect(cliPaths({ HOME: "/home/me", USERPROFILE }).home).toBe("/home/me");
  });
});

describe("the plugin's paths on Windows", () => {
  // The layout is the same one as on Linux and macOS, under the Windows home folder:
  // %USERPROFILE%\.local\bin, %USERPROFILE%\.local\share, %USERPROFILE%\.config — and
  // Claude Code's own folder is %USERPROFILE%\.claude. Deliberately not %APPDATA%
  // (`docs/windows-setup.md` says why).
  const paths = cliPaths({ ...WINDOWS, USERPROFILE });

  test("Claude Code's own folder, the launcher, the state and the data folders", () => {
    expect(paths.claudeConfigDir).toBe(join(USERPROFILE, ".claude"));
    expect(paths.settingsFile).toBe(join(USERPROFILE, ".claude", "settings.json"));
    expect(paths.binDir).toBe(join(USERPROFILE, ".local", "bin"));
    expect(paths.stateDir).toBe(join(USERPROFILE, ".claude", "cc-smart-dev-kit"));
    expect(paths.dataDir).toBe(join(USERPROFILE, ".local", "share", "cc-smart-dev-kit"));
    expect(paths.userConfigFile).toBe(join(USERPROFILE, ".claude.json"));
  });

  test("the gateway's config and state, which the router bundle reads too", () => {
    expect(paths.gatewayConfigFile).toBe(
      join(USERPROFILE, ".config", "cc-smart-dev-kit", "gateway.json"),
    );
    expect(paths.gatewayStateFile).toBe(
      join(USERPROFILE, ".local", "state", "cc-smart-dev-kit", "gateway-state.json"),
    );
  });

  test("the key file beside the config folder, not under the home", () => {
    expect(paths.tavilyKeyFile).toBe(
      join(USERPROFILE, ".claude", "cc-smart-dev-kit", "tavily.key"),
    );
  });
});
