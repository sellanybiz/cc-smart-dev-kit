import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { MARKETPLACE_SOURCE, VERSION } from "../build-info";
import { installLauncher } from "../setup/launcher";
import { listBackups } from "../setup/write";
import { tempDir } from "../testing/temp";

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");

interface SetupOptions {
  marketplace?: boolean;
  gitOk?: boolean;
  /** The marketplace source in known_marketplaces.json. Default: github example-org/cc-agentic. */
  source?: Record<string, string>;
  /** The version in the marketplace's local copy. Default: VERSION. null: no manifest there. */
  marketplaceVersion?: string | null;
}

/** A temp HOME as it looks right after `claude plugin install cc@cc-agentic`. */
function setup(options: SetupOptions = {}) {
  const home = tempDir("cli");
  const configDir = join(home, ".claude");
  const stateDir = join(configDir, "cc-agentic");
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

  // Claude Code's local copy of the marketplace, with the plugin's manifest in it.
  const installLocation = join(configDir, "plugins", "marketplaces", "cc-agentic");
  const marketplaceVersion =
    options.marketplaceVersion === undefined ? VERSION : options.marketplaceVersion;
  if (marketplaceVersion !== null) {
    mkdirSync(join(installLocation, "plugin", ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(installLocation, "plugin", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "cc", version: marketplaceVersion }),
    );
  }
  writeFileSync(
    join(configDir, "plugins", "known_marketplaces.json"),
    JSON.stringify({
      "cc-agentic": {
        source: options.source ?? { source: "github", repo: "example-org/cc-agentic" },
        installLocation,
      },
    }),
  );

  // A fake git first on PATH, so doctor's access check never reaches the network.
  // It logs each call, has no core.sshCommand, and fails ls-remote when gitOk is false.
  const fakeBin = join(home, "fake-bin");
  const gitLog = join(home, "git-calls.log");
  mkdirSync(fakeBin);
  writeFileSync(
    join(fakeBin, "git"),
    [
      "#!/bin/sh",
      `echo "$* | prompt=$GIT_TERMINAL_PROMPT | ssh=$GIT_SSH_COMMAND" >> ${JSON.stringify(gitLog)}`,
      '[ "$1" = config ] && exit 1',
      options.gitOk === false
        ? "echo \"fatal: unable to access 'https://bot:tok@git.example.com/r.git/': 403\" >&2; exit 128"
        : "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(join(fakeBin, "git"), 0o755);

  const env: Record<string, string> = {
    HOME: home,
    CLAUDE_CONFIG_DIR: configDir,
    PATH: `${fakeBin}:${join(home, ".local", "bin")}:${process.env.PATH ?? ""}`,
  };
  const run = (args: string[], extraEnv: Record<string, string> = {}) => {
    const result = Bun.spawnSync(["bun", CLI, ...args], {
      env: { ...env, ...extraEnv },
      stdout: "pipe",
      stderr: "pipe",
    });
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
    stateDir,
    settingsFile,
    binDir: join(home, ".local", "bin"),
    launcher: join(home, ".local", "bin", "cc-agentic"),
    run,
    gitCalls,
  };
}

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("cc-agentic setup", () => {
  test("installs the launcher and turns on auto-update, keeping the other settings", () => {
    const { settingsFile, launcher, run } = setup();
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "+ ~/.local/bin/cc-agentic: launcher created",
        '~ ~/.claude/settings.json: extraKnownMarketplaces["cc-agentic"].autoUpdate: (none) -> true',
        "Done. Each changed file has a backup in ~/.claude/cc-agentic/backups/.",
        "",
      ].join("\n"),
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

  test("the backups go into the state folder, never beside the files", () => {
    const { configDir, stateDir, settingsFile, binDir, run } = setup();
    run(["setup"]);
    expect(listBackups(stateDir, settingsFile)).toHaveLength(1);
    expect(readdirSync(binDir)).toEqual(["cc-agentic"]);
    expect(readdirSync(configDir).sort()).toEqual(["cc-agentic", "plugins", "settings.json"]);
  });

  test("a second run changes nothing", () => {
    const { stateDir, settingsFile, run } = setup();
    run(["setup"]);
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Nothing to change. Setup is up to date.\n");
    expect(listBackups(stateDir, settingsFile)).toHaveLength(1);
  });

  test("--dry-run prints the changes and writes nothing at all: no state folder, no lock", () => {
    const { home, stateDir, settingsFile, run } = setup();
    const before = readFileSync(settingsFile, "utf8");
    const result = run(["setup", "--dry-run"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "+ ~/.local/bin/cc-agentic: launcher created",
        '~ ~/.claude/settings.json: extraKnownMarketplaces["cc-agentic"].autoUpdate: (none) -> true',
        "Dry run: nothing was written.",
        "",
      ].join("\n"),
    );
    expect(readFileSync(settingsFile, "utf8")).toBe(before);
    expect(existsSync(stateDir)).toBe(false);
    expect(existsSync(join(home, ".local"))).toBe(false);
  });

  test("a key the user set (autoUpdate: false) fails before anything is written", () => {
    const { stateDir, settingsFile, launcher, run } = setup();
    const settings = readJson(settingsFile);
    settings.extraKnownMarketplaces["cc-agentic"].autoUpdate = false;
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    const before = readFileSync(settingsFile, "utf8");
    const result = run(["setup"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'extraKnownMarketplaces["cc-agentic"].autoUpdate is false, set by someone else.',
    );
    expect(readFileSync(settingsFile, "utf8")).toBe(before);
    expect(existsSync(launcher)).toBe(false);
    expect(existsSync(stateDir)).toBe(false);
  });

  test("a note when ~/.local/bin is not on PATH, and none when it is", () => {
    const { run } = setup();
    expect(run(["setup"]).stdout).not.toContain("Note:");
    const withoutBin = run(["setup"], { PATH: process.env.PATH ?? "" });
    expect(withoutBin.stdout).toContain(
      "Note: ~/.local/bin is not on your PATH. Add it, so the cc-agentic command works.",
    );
  });

  test("refuses when the marketplace is not added yet", () => {
    const { launcher, run } = setup({ marketplace: false });
    const result = run(["setup"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `Run first: claude plugin marketplace add ${MARKETPLACE_SOURCE}\n`,
    );
    expect(existsSync(launcher)).toBe(false);
  });

  test("restore undoes setup's last change", () => {
    const { settingsFile, launcher, run } = setup();
    const before = readFileSync(settingsFile, "utf8");
    run(["setup"]);
    const result = run(["restore"]);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(settingsFile, "utf8")).toBe(before);
    expect(existsSync(launcher)).toBe(false);
  });
});

describe("cc-agentic doctor", () => {
  test("all green after setup, through the launcher; git reads the marketplace over SSH", () => {
    const { run, gitCalls } = setup();
    run(["setup"]);
    const result = run(["doctor"]);
    expect(result.stdout).toBe(
      [
        `✓ cc@cc-agentic ${VERSION} is installed at ~/.claude/plugins/cache/cc-agentic/cc/${VERSION}`,
        `✓ the installed version ${VERSION} is not behind the marketplace`,
        `✓ the launcher ~/.local/bin/cc-agentic runs cc-agentic ${VERSION}`,
        "✓ can read the marketplace at git@github.com:example-org/cc-agentic.git",
        "✓ plugin auto-update is on",
        "✓ plugin updates are not switched off",
        "✓ no other enabled plugin is named cc",
        // The gateway is optional: never set up is information, not a failure.
        "· gateway: not set up (optional). To use it: cc-agentic gateway setup",
        "",
      ].join("\n"),
    );
    expect(result.exitCode).toBe(0);
    // git is asked for the user's own ssh command, then told never to ask for a password.
    expect(gitCalls()).toBe(
      [
        "config --get core.sshCommand | prompt=0 | ssh=",
        "ls-remote git@github.com:example-org/cc-agentic.git HEAD | prompt=0 | ssh=ssh -o BatchMode=yes -o ConnectTimeout=8",
        "",
      ].join("\n"),
    );
  });

  test("no access to the marketplace: ✗ naming both URLs tried, exit 1", () => {
    const { run, gitCalls } = setup({ gitOk: false });
    run(["setup"]);
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ cannot read the marketplace (" +
        "git@github.com:example-org/cc-agentic.git: fatal: unable to access 'https://***@git.example.com/r.git/': 403; " +
        "https://github.com/example-org/cc-agentic.git: fatal: unable to access 'https://***@git.example.com/r.git/': 403). " +
        "Check your git access: an SSH key, or a git credential helper.",
    );
    expect(gitCalls().match(/ls-remote/g)).toHaveLength(2);
  });

  test("a marketplace URL with a token: the token is never printed", () => {
    const source = {
      source: "git",
      url: "https://bot:secret-token@git.example.com/tools.git?x=1",
    };
    const ok = setup({ source }).run(["doctor"]);
    expect(ok.stdout).toContain(
      "✓ can read the marketplace at https://***@git.example.com/tools.git?***\n",
    );
    const failed = setup({ source, gitOk: false }).run(["doctor"]);
    expect(failed.stdout).toContain(
      "✗ cannot read the marketplace (https://***@git.example.com/tools.git?***: fatal:",
    );
    expect(`${ok.stdout}${failed.stdout}`).not.toContain("secret-token");
  });

  test("the marketplace is not added: ✗ with the add command", () => {
    const { configDir, run } = setup();
    writeFileSync(join(configDir, "plugins", "known_marketplaces.json"), "{}");
    const result = run(["doctor"]);
    expect(result.stdout).toContain(
      `✗ the cc-agentic marketplace is not added. Run: claude plugin marketplace add ${MARKETPLACE_SOURCE}\n`,
    );
  });

  test("the installed version is behind the marketplace: ✗ with the update command", () => {
    const { run } = setup({ marketplaceVersion: "99.0.0" });
    run(["setup"]);
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      `✗ installed ${VERSION}, marketplace has 99.0.0. Run: claude plugin update cc@cc-agentic\n`,
    );
  });

  test("the marketplace's local copy has no plugin manifest: ✗ with the marketplace update command", () => {
    const { run } = setup({ marketplaceVersion: null });
    run(["setup"]);
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ cannot read the version in ~/.claude/plugins/marketplaces/cc-agentic/plugin/.claude-plugin/plugin.json. " +
        "Run: claude plugin marketplace update cc-agentic\n",
    );
  });

  test.each(["DISABLE_AUTOUPDATER", "DISABLE_UPDATES", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"])(
    "%s set: ✗ naming it; with FORCE_AUTOUPDATE_PLUGINS too: ✓",
    (name) => {
      const { run } = setup();
      run(["setup"]);
      const off = run(["doctor"], { [name]: "1" });
      expect(off.exitCode).toBe(1);
      expect(off.stdout).toContain(
        `✗ plugin updates are switched off: ${name} (in your environment) is set. ` +
          `Set FORCE_AUTOUPDATE_PLUGINS=1 as well, or remove ${name}.\n`,
      );
      const forced = run(["doctor"], { [name]: "1", FORCE_AUTOUPDATE_PLUGINS: "1" });
      expect(forced.stdout).toContain(
        "✓ plugin updates are on (FORCE_AUTOUPDATE_PLUGINS is set)\n",
      );
      expect(forced.exitCode).toBe(0);
    },
  );

  test("an update switch in the env of settings.json counts too; a value of 0 does not", () => {
    const { settingsFile, run } = setup();
    run(["setup"]);
    const settings = readJson(settingsFile);
    settings.env = { DISABLE_UPDATES: "true" };
    writeFileSync(settingsFile, JSON.stringify(settings));
    expect(run(["doctor"], { DISABLE_AUTOUPDATER: "0" }).stdout).toContain(
      "✗ plugin updates are switched off: DISABLE_UPDATES (in the env of ~/.claude/settings.json) is set. " +
        "Set FORCE_AUTOUPDATE_PLUGINS=1 as well, or remove DISABLE_UPDATES.\n",
    );
  });

  test("a launcher baked with another bun than the one running doctor is not out of date", () => {
    const { stateDir, binDir, run } = setup();
    run(["setup"]);
    // The same bun under another path, as when setup ran with another bun first on PATH.
    const otherBun = join(tempDir("other-bun"), "bun");
    symlinkSync(process.execPath, otherBun);
    installLauncher(binDir, { stateDir, bunPath: otherBun });
    const result = run(["doctor"]);
    expect(result.stdout).toContain(
      `✓ the launcher ~/.local/bin/cc-agentic runs cc-agentic ${VERSION}\n`,
    );
  });

  test("the launcher's baked bun is gone: ✗ with the setup command", () => {
    const { stateDir, binDir, run } = setup();
    run(["setup"]);
    const gone = join(tempDir("gone"), "bun");
    installLauncher(binDir, { stateDir, bunPath: gone });
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      `✗ the launcher's bun ${gone} is missing or not executable. Run: cc-agentic setup\n`,
    );
  });

  test("a launcher someone edited is out of date", () => {
    const { launcher, run } = setup();
    run(["setup"]);
    writeFileSync(launcher, `${readFileSync(launcher, "utf8")}# edited\n`);
    expect(run(["doctor"]).stdout).toContain(
      "✗ the launcher ~/.local/bin/cc-agentic is out of date. Run: cc-agentic setup\n",
    );
  });

  test("before setup: no launcher and auto-update off, exit 1", () => {
    const { run } = setup();
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("✗ no launcher at ~/.local/bin/cc-agentic");
    expect(result.stdout).toContain("✗ plugin auto-update is off");
  });

  test("not installed: one ✗ for it, and no version line", () => {
    const { configDir, run } = setup();
    rmSync(join(configDir, "plugins", "installed_plugins.json"));
    const result = run(["doctor"]);
    expect(result.stdout).toContain(
      "✗ the cc@cc-agentic plugin is not installed. Run: claude plugin install cc@cc-agentic\n",
    );
    expect(result.stdout).not.toContain("marketplace has");
    expect(result.stdout).not.toContain("not behind");
  });

  test("another plugin named cc is enabled: ✗, exit 1", () => {
    const { settingsFile, run } = setup();
    run(["setup"]);
    const settings = readJson(settingsFile);
    settings.enabledPlugins["cc@someone-else"] = true;
    writeFileSync(settingsFile, JSON.stringify(settings));
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("✗ another plugin named cc is enabled: cc@someone-else");
  });
});

describe("cc-agentic version and help", () => {
  test("version prints the plugin version", () => {
    expect(setup().run(["version"]).stdout).toBe(`cc-agentic ${VERSION}\n`);
  });

  test("an unknown command prints help and exits 2", () => {
    const result = setup().run(["nope"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown command: nope");
  });
});
