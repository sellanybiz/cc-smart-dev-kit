import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../testing/timeouts";
import { findUserInstall } from "./installed-plugins";
import { bakedBunPath, installLauncher, launcherScript } from "./launcher";

// This file starts the launcher as a real process (it starts bun, and a stand-in CLI):
// its own speed limit (src/testing/timeouts.ts).
setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS);

describe("bakedBunPath", () => {
  test.each([
    ["/home/user/.bun/bin/bun"],
    ["/opt/it's here/bun"],
    ["/a/'quoted'/b'"],
    ["/with space/and$dollar/bun"],
  ])("reads back the bun baked into the script: %s", (bun) => {
    expect(bakedBunPath(launcherScript(bun))).toBe(bun);
  });

  test("a script without the line gives null", () => {
    expect(bakedBunPath("#!/bin/sh\nexec bun cli.js\n")).toBeNull();
  });
});

/**
 * A fake plugin version whose dist/cli.js prints its name and its arguments as JSON, with the
 * empty `bunfig.toml` a real install ships beside it (the launcher points bun at that file).
 */
function fakeVersion(cacheDir: string, version: string): string {
  const installPath = join(cacheDir, version);
  mkdirSync(join(installPath, "dist"), { recursive: true });
  writeFileSync(
    join(installPath, "dist", "cli.js"),
    `console.log(JSON.stringify({ version: ${JSON.stringify(version)}, argv: process.argv.slice(2) }));\n`,
  );
  writeFileSync(join(installPath, "bunfig.toml"), "");
  return installPath;
}

function writeInstalled(configDir: string, entries: unknown[]): string {
  mkdirSync(join(configDir, "plugins"), { recursive: true });
  const file = join(configDir, "plugins", "installed_plugins.json");
  writeFileSync(
    file,
    JSON.stringify({ version: 2, plugins: { "cc-smart-dev-kit@cc-smart-dev-kit": entries } }),
  );
  return file;
}

function userEntry(installPath: string, version: string) {
  return { scope: "user", installPath, version, gitCommitSha: "abc123" };
}

/** `bunPath`: the bun baked into the launcher. Default: the bun running this test. */
function setup(bunPath = process.execPath) {
  const home = tempDir("launcher");
  const configDir = join(home, ".claude");
  const cacheDir = join(configDir, "plugins", "cache", "cc-smart-dev-kit", "cc-smart-dev-kit");
  const binDir = join(home, ".local", "bin");
  const stateDir = join(configDir, "cc-smart-dev-kit");
  const launcher = installLauncher(binDir, { stateDir, bunPath }).path;
  return { home, configDir, cacheDir, launcher };
}

/** A PATH with no bun on it: one empty folder. */
const pathWithoutBun = () => tempDir("empty-path");

function runLauncher(launcher: string, env: Record<string, string>, args: string[], cwd?: string) {
  const result = Bun.spawnSync([launcher, ...args], {
    env: { PATH: process.env.PATH ?? "", ...env },
    ...(cwd === undefined ? {} : { cwd }),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("the launcher", () => {
  test("is written with mode 755", () => {
    const { launcher } = setup();
    expect(statSync(launcher).mode & 0o777).toBe(0o755);
  });

  test("works with no bun on PATH, through the bun baked in by setup", () => {
    const { home, configDir, cacheDir, launcher } = setup(process.execPath);
    writeInstalled(configDir, [userEntry(fakeVersion(cacheDir, "1.0.0"), "1.0.0")]);
    const env = { HOME: home, CLAUDE_CONFIG_DIR: configDir, PATH: pathWithoutBun() };
    const result = runLauncher(launcher, env, ["version"]);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ version: "1.0.0", argv: ["version"] });
  });

  test("falls back to bun on PATH when the baked bun is gone", () => {
    const { home, configDir, cacheDir, launcher } = setup(join(tempDir("gone"), "bun"));
    writeInstalled(configDir, [userEntry(fakeVersion(cacheDir, "1.0.0"), "1.0.0")]);
    const result = runLauncher(launcher, { HOME: home, CLAUDE_CONFIG_DIR: configDir }, ["x"]);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ version: "1.0.0", argv: ["x"] });
  });

  test("no bun anywhere: a clear message and exit 1", () => {
    const gone = join(tempDir("gone"), "bun");
    const { home, configDir, cacheDir, launcher } = setup(gone);
    writeInstalled(configDir, [userEntry(fakeVersion(cacheDir, "1.0.0"), "1.0.0")]);
    const env = { HOME: home, CLAUDE_CONFIG_DIR: configDir, PATH: pathWithoutBun() };
    const result = runLauncher(launcher, env, []);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      `cc-smart-dev-kit: bun not found (not at ${gone}, not on PATH). Install bun, then run: cc-smart-dev-kit setup\n`,
    );
  });

  test("a bun path with a quote in it is kept intact", () => {
    const { launcher } = setup("/opt/it's here/bun");
    expect(readFileSync(launcher, "utf8")).toContain("baked_bun='/opt/it'\\''s here/bun'\n");
  });

  test("runs the installed version's cli.js and passes every argument through", () => {
    const { home, configDir, cacheDir, launcher } = setup();
    const installPath = fakeVersion(cacheDir, "1.0.0");
    writeInstalled(configDir, [userEntry(installPath, "1.0.0")]);
    const args = ["setup", "--dry-run", "two words", "it's", "$HOME", ""];
    const result = runLauncher(launcher, { HOME: home, CLAUDE_CONFIG_DIR: configDir }, args);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ version: "1.0.0", argv: args });
  });

  test("uses $HOME/.claude when CLAUDE_CONFIG_DIR is not set", () => {
    const { home, configDir, cacheDir, launcher } = setup();
    writeInstalled(configDir, [userEntry(fakeVersion(cacheDir, "1.0.0"), "1.0.0")]);
    const result = runLauncher(launcher, { HOME: home }, ["version"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ version: "1.0.0", argv: ["version"] });
  });

  test("follows a version change: the new installPath runs", () => {
    const { home, configDir, cacheDir, launcher } = setup();
    writeInstalled(configDir, [userEntry(fakeVersion(cacheDir, "1.0.0"), "1.0.0")]);
    writeInstalled(configDir, [userEntry(fakeVersion(cacheDir, "1.1.0"), "1.1.0")]);
    const result = runLauncher(launcher, { HOME: home, CLAUDE_CONFIG_DIR: configDir }, ["x"]);
    expect(JSON.parse(result.stdout)).toEqual({ version: "1.1.0", argv: ["x"] });
  });

  test("ignores a project-scope install and uses the user-scope one", () => {
    const { home, configDir, cacheDir, launcher } = setup();
    writeInstalled(configDir, [
      { scope: "project", installPath: fakeVersion(cacheDir, "9.9.9"), projectPath: home },
      userEntry(fakeVersion(cacheDir, "1.0.0"), "1.0.0"),
    ]);
    const result = runLauncher(launcher, { HOME: home, CLAUDE_CONFIG_DIR: configDir }, []);
    expect(JSON.parse(result.stdout)).toEqual({ version: "1.0.0", argv: [] });
  });

  test("--config: the working folder's bunfig.toml never runs inside the command, or its lookup", () => {
    // The launcher runs in whatever folder the person is in. bun reads that folder's
    // bunfig.toml, so a project's `preload` would run its own code inside the command — and
    // inside the little lookup that finds the install path, where a printed line would be
    // taken as that path. `--config` covers the command; the lookup runs in the launcher's
    // own folder. Run for real: the bun running this test is the one baked in.
    const { home, configDir, cacheDir, launcher } = setup(process.execPath);
    writeInstalled(configDir, [userEntry(fakeVersion(cacheDir, "1.0.0"), "1.0.0")]);
    const project = tempDir("project");
    writeFileSync(join(project, "preload.js"), 'console.log("PRELOAD RAN");\n');
    writeFileSync(join(project, "bunfig.toml"), 'preload = ["./preload.js"]\n');
    const result = runLauncher(
      launcher,
      { HOME: home, CLAUDE_CONFIG_DIR: configDir, PATH: pathWithoutBun() },
      ["version"],
      project,
    );
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ version: "1.0.0", argv: ["version"] });
  });

  test("a version folder with no bunfig.toml (0.2.x, until migrate replaces it) still runs", () => {
    // The plugin's own empty config arrived with 0.3.0. An older installed version has none,
    // and bun refuses a config path that does not exist: the flag is left out for it.
    const { home, configDir, cacheDir, launcher } = setup(process.execPath);
    const installPath = fakeVersion(cacheDir, "1.0.0");
    rmSync(join(installPath, "bunfig.toml"));
    writeInstalled(configDir, [userEntry(installPath, "1.0.0")]);
    const result = runLauncher(
      launcher,
      { HOME: home, CLAUDE_CONFIG_DIR: configDir, PATH: pathWithoutBun() },
      ["version"],
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ version: "1.0.0", argv: ["version"] });
  });

  test("a removed version folder gives the install message and exit 1", () => {
    const { home, configDir, cacheDir, launcher } = setup();
    const installPath = fakeVersion(cacheDir, "1.0.0");
    writeInstalled(configDir, [userEntry(installPath, "1.0.0")]);
    rmSync(installPath, { recursive: true });
    const result = runLauncher(launcher, { HOME: home, CLAUDE_CONFIG_DIR: configDir }, ["x"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `cc-smart-dev-kit: the cc-smart-dev-kit plugin folder is missing: ${installPath}. Run: claude plugin install cc-smart-dev-kit@cc-smart-dev-kit\n`,
    );
  });

  test("no installed_plugins.json gives the install message and exit 1", () => {
    const { home, configDir, launcher } = setup();
    const result = runLauncher(launcher, { HOME: home, CLAUDE_CONFIG_DIR: configDir }, []);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "cc-smart-dev-kit: the cc-smart-dev-kit plugin is not installed. Run: claude plugin install cc-smart-dev-kit@cc-smart-dev-kit\n",
    );
  });

  test("no user-scope entry gives the install message and exit 1", () => {
    const { home, configDir, cacheDir, launcher } = setup();
    writeInstalled(configDir, [{ scope: "project", installPath: fakeVersion(cacheDir, "1.0.0") }]);
    const result = runLauncher(launcher, { HOME: home, CLAUDE_CONFIG_DIR: configDir }, []);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Run: claude plugin install cc-smart-dev-kit@cc-smart-dev-kit");
  });
});

describe("findUserInstall (the same lookup in TypeScript)", () => {
  test("finds the user-scope entry and its version", () => {
    const dir = tempDir("installed");
    const file = writeInstalled(dir, [
      { scope: "project", installPath: "/p" },
      userEntry("/u/1.0.0", "1.0.0"),
    ]);
    expect(findUserInstall(file)).toEqual({ installPath: "/u/1.0.0", version: "1.0.0" });
  });

  test("gives null without a user-scope entry or without the file", () => {
    const dir = tempDir("installed");
    const file = writeInstalled(dir, [{ scope: "project", installPath: "/p" }]);
    expect(findUserInstall(file)).toBeNull();
    expect(findUserInstall(join(dir, "missing.json"))).toBeNull();
  });
});
