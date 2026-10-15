import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MARKETPLACE_SOURCE, VERSION } from "../build-info";
import { listBackups } from "../setup/write";
import { tempDir } from "../testing/temp";

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");

/** A temp HOME as it looks right after `claude plugin install cc@cc-agentic`. */
function setup(options: { marketplace?: boolean; gitOk?: boolean } = {}) {
  const home = tempDir("cli");
  const configDir = join(home, ".claude");
  const settingsFile = join(configDir, "settings.json");
  mkdirSync(configDir, { recursive: true });
  const settings: Record<string, unknown> = {
    model: "opus",
    enabledPlugins: { "cc@cc-agentic": true },
  };
  if (options.marketplace !== false) {
    settings.extraKnownMarketplaces = {
      "cc-agentic": { source: { source: "github", repo: "example-org/cc-agentic" } },
    };
  }
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);

  // The installed plugin: its dist/cli.js is this CLI's source, so the launcher runs real code.
  const installPath = join(configDir, "plugins", "cache", "cc-agentic", "cc", VERSION);
  mkdirSync(join(installPath, "dist"), { recursive: true });
  writeFileSync(join(installPath, "dist", "cli.js"), `await import(${JSON.stringify(CLI)});\n`);
  writeFileSync(
    join(configDir, "plugins", "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: { "cc@cc-agentic": [{ scope: "user", installPath, version: VERSION }] },
    }),
  );

  writeFileSync(
    join(configDir, "plugins", "known_marketplaces.json"),
    JSON.stringify({
      "cc-agentic": {
        source: { source: "github", repo: "example-org/cc-agentic" },
        installLocation: join(configDir, "plugins", "marketplaces", "cc-agentic"),
      },
    }),
  );

  // A fake git first on PATH, so doctor's access check never reaches the network.
  // It logs each call, and fails ls-remote when gitOk is false.
  const fakeBin = join(home, "fake-bin");
  const gitLog = join(home, "git-calls.log");
  mkdirSync(fakeBin);
  writeFileSync(
    join(fakeBin, "git"),
    [
      "#!/bin/sh",
      `echo "$* | prompt=$GIT_TERMINAL_PROMPT" >> ${JSON.stringify(gitLog)}`,
      options.gitOk === false
        ? 'echo "fatal: Could not read from remote repository." >&2; exit 128'
        : "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(join(fakeBin, "git"), 0o755);

  const env = {
    HOME: home,
    CLAUDE_CONFIG_DIR: configDir,
    PATH: `${fakeBin}:${join(home, ".local", "bin")}:${process.env.PATH ?? ""}`,
  };
  const run = (...args: string[]) => {
    const result = Bun.spawnSync(["bun", CLI, ...args], { env, stdout: "pipe", stderr: "pipe" });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  };
  const gitCalls = () => (existsSync(gitLog) ? readFileSync(gitLog, "utf8") : "");
  return {
    home,
    configDir,
    settingsFile,
    launcher: join(home, ".local", "bin", "cc-agentic"),
    run,
    gitCalls,
  };
}

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("cc-agentic setup", () => {
  test("installs the launcher and turns on auto-update, keeping the other settings", () => {
    const { settingsFile, launcher, run } = setup();
    const result = run("setup");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("+ ~/.local/bin/cc-agentic: launcher created");
    expect(result.stdout).toContain(
      '~ ~/.claude/settings.json: extraKnownMarketplaces["cc-agentic"].autoUpdate: (none) -> true',
    );
    expect(existsSync(launcher)).toBe(true);
    expect(readJson(settingsFile)).toEqual({
      model: "opus",
      enabledPlugins: { "cc@cc-agentic": true },
      extraKnownMarketplaces: {
        "cc-agentic": {
          source: { source: "github", repo: "example-org/cc-agentic" },
          autoUpdate: true,
        },
      },
    });
  });

  test("a second run changes nothing", () => {
    const { settingsFile, run } = setup();
    run("setup");
    const result = run("setup");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Nothing to change.");
    expect(listBackups(settingsFile)).toHaveLength(1);
  });

  test("--dry-run prints the changes and writes nothing", () => {
    const { settingsFile, launcher, run } = setup();
    const before = readFileSync(settingsFile, "utf8");
    const result = run("setup", "--dry-run");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("autoUpdate: (none) -> true");
    expect(result.stdout).toContain("Dry run: nothing was written.");
    expect(readFileSync(settingsFile, "utf8")).toBe(before);
    expect(existsSync(launcher)).toBe(false);
  });

  test("refuses when the marketplace is not added yet", () => {
    const { launcher, run } = setup({ marketplace: false });
    const result = run("setup");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `Run first: claude plugin marketplace add ${MARKETPLACE_SOURCE}\n`,
    );
    expect(existsSync(launcher)).toBe(false);
  });

  test("restore undoes setup's last change", () => {
    const { settingsFile, launcher, run } = setup();
    const before = readFileSync(settingsFile, "utf8");
    run("setup");
    const result = run("restore");
    expect(result.exitCode).toBe(0);
    expect(readFileSync(settingsFile, "utf8")).toBe(before);
    expect(existsSync(launcher)).toBe(false);
  });
});

describe("cc-agentic doctor", () => {
  test("all green after setup, through the launcher; git reads the marketplace over SSH", () => {
    const { run, gitCalls } = setup();
    run("setup");
    const result = run("doctor");
    expect(result.stdout).toBe(
      [
        `✓ cc@cc-agentic ${VERSION} is installed at ~/.claude/plugins/cache/cc-agentic/cc/${VERSION}`,
        `✓ the launcher ~/.local/bin/cc-agentic runs cc-agentic ${VERSION}`,
        "✓ can read the marketplace at git@github.com:example-org/cc-agentic.git",
        "✓ plugin auto-update is on",
        "✓ no other enabled plugin is named cc",
        "",
      ].join("\n"),
    );
    expect(result.exitCode).toBe(0);
    // One call, and git is told never to ask for a password.
    expect(gitCalls()).toBe(
      "ls-remote git@github.com:example-org/cc-agentic.git HEAD | prompt=0\n",
    );
  });

  test("no access to the marketplace: ✗ naming both URLs tried, exit 1", () => {
    const { run, gitCalls } = setup({ gitOk: false });
    run("setup");
    const result = run("doctor");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ cannot read the marketplace (" +
        "git@github.com:example-org/cc-agentic.git: fatal: Could not read from remote repository.; " +
        "https://github.com/example-org/cc-agentic.git: fatal: Could not read from remote repository.). " +
        "Check your git access: an SSH key, or a git credential helper.",
    );
    expect(gitCalls().trim().split("\n")).toHaveLength(2);
  });

  test("the marketplace is not added: ✗ with the add command", () => {
    const { configDir, run } = setup();
    writeFileSync(join(configDir, "plugins", "known_marketplaces.json"), "{}");
    const result = run("doctor");
    expect(result.stdout).toContain(
      `✗ the cc-agentic marketplace is not added. Run: claude plugin marketplace add ${MARKETPLACE_SOURCE}\n`,
    );
  });

  test("before setup: no launcher and auto-update off, exit 1", () => {
    const { run } = setup();
    const result = run("doctor");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("✗ no launcher at ~/.local/bin/cc-agentic");
    expect(result.stdout).toContain("✗ plugin auto-update is off");
  });

  test("another plugin named cc is enabled: ✗, exit 1", () => {
    const { settingsFile, run } = setup();
    run("setup");
    const settings = readJson(settingsFile);
    settings.enabledPlugins["cc@someone-else"] = true;
    writeFileSync(settingsFile, JSON.stringify(settings));
    const result = run("doctor");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("✗ another plugin named cc is enabled: cc@someone-else");
  });
});

describe("cc-agentic version and help", () => {
  test("version prints the plugin version", () => {
    expect(setup().run("version").stdout).toBe(`cc-agentic ${VERSION}\n`);
  });

  test("an unknown command prints help and exits 2", () => {
    const result = setup().run("nope");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown command: nope");
  });
});
