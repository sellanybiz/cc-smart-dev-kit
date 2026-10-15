import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { findUserInstall } from "./installed-plugins";
import { bakedBunPath, installLauncher, launcherScript } from "./launcher";

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

/** A fake plugin version whose dist/cli.js prints its name and its arguments as JSON. */
function fakeVersion(cacheDir: string, version: string): string {
  const installPath = join(cacheDir, version);
  mkdirSync(join(installPath, "dist"), { recursive: true });
  writeFileSync(
    join(installPath, "dist", "cli.js"),
    `console.log(JSON.stringify({ version: ${JSON.stringify(version)}, argv: process.argv.slice(2) }));\n`,
  );
  return installPath;
}

function writeInstalled(configDir: string, entries: unknown[]): string {
  mkdirSync(join(configDir, "plugins"), { recursive: true });
  const file = join(configDir, "plugins", "installed_plugins.json");
  writeFileSync(file, JSON.stringify({ version: 2, plugins: { "cc@cc-agentic": entries } }));
  return file;
}

function userEntry(installPath: string, version: string) {
  return { scope: "user", installPath, version, gitCommitSha: "abc123" };
}

/** `bunPath`: the bun baked into the launcher. Default: the bun running this test. */
function setup(bunPath = process.execPath) {
  const home = tempDir("launcher");
  const configDir = join(home, ".claude");
  const cacheDir = join(configDir, "plugins", "cache", "cc-agentic", "cc");
  const binDir = join(home, ".local", "bin");
  const stateDir = join(configDir, "cc-agentic");
  const launcher = installLauncher(binDir, { stateDir, bunPath }).path;
  return { home, configDir, cacheDir, launcher };
}

/** A PATH with no bun on it: one empty folder. */
const pathWithoutBun = () => tempDir("empty-path");

function runLauncher(launcher: string, env: Record<string, string>, args: string[]) {
  const result = Bun.spawnSync([launcher, ...args], {
    env: { PATH: process.env.PATH ?? "", ...env },
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
      `cc-agentic: bun not found (not at ${gone}, not on PATH). Install bun, then run: cc-agentic setup\n`,
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

  test("a removed version folder gives the install message and exit 1", () => {
    const { home, configDir, cacheDir, launcher } = setup();
    const installPath = fakeVersion(cacheDir, "1.0.0");
    writeInstalled(configDir, [userEntry(installPath, "1.0.0")]);
    rmSync(installPath, { recursive: true });
    const result = runLauncher(launcher, { HOME: home, CLAUDE_CONFIG_DIR: configDir }, ["x"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `cc-agentic: the cc plugin folder is missing: ${installPath}. Run: claude plugin install cc@cc-agentic\n`,
    );
  });

  test("no installed_plugins.json gives the install message and exit 1", () => {
    const { home, configDir, launcher } = setup();
    const result = runLauncher(launcher, { HOME: home, CLAUDE_CONFIG_DIR: configDir }, []);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "cc-agentic: the cc plugin is not installed. Run: claude plugin install cc@cc-agentic\n",
    );
  });

  test("no user-scope entry gives the install message and exit 1", () => {
    const { home, configDir, cacheDir, launcher } = setup();
    writeInstalled(configDir, [{ scope: "project", installPath: fakeVersion(cacheDir, "1.0.0") }]);
    const result = runLauncher(launcher, { HOME: home, CLAUDE_CONFIG_DIR: configDir }, []);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Run: claude plugin install cc@cc-agentic");
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
