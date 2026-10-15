import { describe, expect, spyOn, test } from "bun:test";
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
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import { cliPaths } from "./paths";
import { runSetup } from "./setup";

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");

interface SetupOptions {
  marketplace?: boolean;
  gitOk?: boolean;
  /** The marketplace source in known_marketplaces.json. Default: github example-org/anymodel. */
  source?: Record<string, string>;
  /** The version in the marketplace's local copy. Default: VERSION. null: no manifest there. */
  marketplaceVersion?: string | null;
}

/** A temp HOME as it looks right after `claude plugin install anymodel@anymodel`. */
function setup(options: SetupOptions = {}) {
  const home = tempDir("cli");
  const configDir = join(home, ".claude");
  const stateDir = join(configDir, "anymodel");
  const settingsFile = join(configDir, "settings.json");
  mkdirSync(configDir, { recursive: true });
  const settings: Record<string, unknown> = {
    model: "opus",
    enabledPlugins: { "anymodel@anymodel": true },
  };
  if (options.marketplace !== false) {
    settings.extraKnownMarketplaces = {
      anymodel: { source: { source: "github", repo: "example-org/anymodel" } },
    };
  }
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);

  // The installed plugin: its dist/cli.js is this CLI's source, so the launcher runs real code.
  const installPath = join(configDir, "plugins", "cache", "anymodel", "anymodel", VERSION);
  mkdirSync(join(installPath, "dist"), { recursive: true });
  writeFileSync(join(installPath, "dist", "cli.js"), `await import(${JSON.stringify(CLI)});\n`);
  writeFileSync(
    join(configDir, "plugins", "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: { "anymodel@anymodel": [{ scope: "user", installPath, version: VERSION }] },
    }),
  );

  // Claude Code's local copy of the marketplace, with the plugin's manifest in it.
  const installLocation = join(configDir, "plugins", "marketplaces", "anymodel");
  const marketplaceVersion =
    options.marketplaceVersion === undefined ? VERSION : options.marketplaceVersion;
  if (marketplaceVersion !== null) {
    mkdirSync(join(installLocation, "plugin", ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(installLocation, "plugin", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "anymodel", version: marketplaceVersion }),
    );
  }
  writeFileSync(
    join(configDir, "plugins", "known_marketplaces.json"),
    JSON.stringify({
      anymodel: {
        source: options.source ?? { source: "github", repo: "example-org/anymodel" },
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
    // The live-router guard runs in the CLI too: no test may reach port 20100.
    const guard = subprocessGuard();
    const result = Bun.spawnSync(["bun", ...guard.args, CLI, ...args], {
      env: { ...env, ...extraEnv, ...guard.env },
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
    launcher: join(home, ".local", "bin", "anymodel"),
    run,
    gitCalls,
  };
}

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("anymodel setup", () => {
  test("installs the launcher and turns on auto-update, keeping the other settings", () => {
    const { settingsFile, launcher, run } = setup();
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "+ ~/.local/bin/anymodel: launcher created",
        "~ ~/.claude/settings.json: extraKnownMarketplaces.anymodel.autoUpdate: (none) -> true",
        "Done. Each changed file has a backup in ~/.claude/anymodel/backups/.",
        "",
      ].join("\n"),
    );
    expect(existsSync(launcher)).toBe(true);
    expect(readJson(settingsFile)).toEqual({
      model: "opus",
      enabledPlugins: { "anymodel@anymodel": true },
      extraKnownMarketplaces: {
        anymodel: {
          source: { source: "github", repo: "example-org/anymodel" },
          autoUpdate: true,
        },
      },
    });
  });

  test("the backups go into the state folder, never beside the files", () => {
    const { configDir, stateDir, settingsFile, binDir, run } = setup();
    run(["setup"]);
    expect(listBackups(stateDir, settingsFile)).toHaveLength(1);
    expect(readdirSync(binDir)).toEqual(["anymodel"]);
    expect(readdirSync(configDir).sort()).toEqual(["anymodel", "plugins", "settings.json"]);
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
        "+ ~/.local/bin/anymodel: launcher created",
        "~ ~/.claude/settings.json: extraKnownMarketplaces.anymodel.autoUpdate: (none) -> true",
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
    settings.extraKnownMarketplaces["anymodel"].autoUpdate = false;
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    const before = readFileSync(settingsFile, "utf8");
    const result = run(["setup"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "extraKnownMarketplaces.anymodel.autoUpdate is false, set by someone else.",
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
      "Note: ~/.local/bin is not on your PATH. Add it, so the anymodel command works.",
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

describe("anymodel doctor", () => {
  test("all green after setup, through the launcher; git reads the marketplace over SSH", () => {
    const { run, gitCalls } = setup();
    run(["setup"]);
    const result = run(["doctor"]);
    expect(result.stdout).toBe(
      [
        `✓ anymodel@anymodel ${VERSION} is installed at ~/.claude/plugins/cache/anymodel/anymodel/${VERSION}`,
        `✓ the installed version ${VERSION} is not behind the marketplace`,
        `✓ the launcher ~/.local/bin/anymodel runs anymodel ${VERSION}`,
        "✓ can read the marketplace at git@github.com:example-org/anymodel.git",
        "✓ plugin auto-update is on",
        "✓ plugin updates are not switched off",
        "✓ no other enabled plugin is named anymodel",
        // The gateway is optional: never set up is information, not a failure.
        "· gateway: not set up (optional). To use it: anymodel gateway setup",
        "",
      ].join("\n"),
    );
    expect(result.exitCode).toBe(0);
    // git is asked for the user's own ssh command, then told never to ask for a password.
    expect(gitCalls()).toBe(
      [
        "config --get core.sshCommand | prompt=0 | ssh=",
        "ls-remote git@github.com:example-org/anymodel.git HEAD | prompt=0 | ssh=ssh -o BatchMode=yes -o ConnectTimeout=8",
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
        "git@github.com:example-org/anymodel.git: fatal: unable to access 'https://***@git.example.com/r.git/': 403; " +
        "https://github.com/example-org/anymodel.git: fatal: unable to access 'https://***@git.example.com/r.git/': 403). " +
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
      `✗ the anymodel marketplace is not added. Run: claude plugin marketplace add ${MARKETPLACE_SOURCE}\n`,
    );
  });

  test("the installed version is behind the marketplace: ✗ with the update command", () => {
    const { run } = setup({ marketplaceVersion: "99.0.0" });
    run(["setup"]);
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      `✗ installed ${VERSION}, marketplace has 99.0.0. Run: claude plugin update anymodel@anymodel\n`,
    );
  });

  test("the marketplace's local copy has no plugin manifest: ✗ with the marketplace update command", () => {
    const { run } = setup({ marketplaceVersion: null });
    run(["setup"]);
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ cannot read the version in ~/.claude/plugins/marketplaces/anymodel/plugin/.claude-plugin/plugin.json. " +
        "Run: claude plugin marketplace update anymodel\n",
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
      `✓ the launcher ~/.local/bin/anymodel runs anymodel ${VERSION}\n`,
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
      `✗ the launcher's bun ${gone} is missing or not executable. Run: anymodel setup\n`,
    );
  });

  test("a launcher someone edited is out of date", () => {
    const { launcher, run } = setup();
    run(["setup"]);
    writeFileSync(launcher, `${readFileSync(launcher, "utf8")}# edited\n`);
    expect(run(["doctor"]).stdout).toContain(
      "✗ the launcher ~/.local/bin/anymodel is out of date. Run: anymodel setup\n",
    );
  });

  test("before setup: no launcher and auto-update off, exit 1", () => {
    const { run } = setup();
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("✗ no launcher at ~/.local/bin/anymodel");
    expect(result.stdout).toContain("✗ plugin auto-update is off");
  });

  test("not installed: one ✗ for it, and no version line", () => {
    const { configDir, run } = setup();
    rmSync(join(configDir, "plugins", "installed_plugins.json"));
    const result = run(["doctor"]);
    expect(result.stdout).toContain(
      "✗ the anymodel@anymodel plugin is not installed. Run: claude plugin install anymodel@anymodel\n",
    );
    expect(result.stdout).not.toContain("marketplace has");
    expect(result.stdout).not.toContain("not behind");
  });

  test("the old plugin id is still enabled: ✗ naming it, with the uninstall command", () => {
    const { settingsFile, run } = setup();
    run(["setup"]);
    const before = run(["doctor"]);
    expect(before.stdout).not.toContain("cc@cc-agentic");
    const settings = readJson(settingsFile);
    settings.enabledPlugins["cc@cc-agentic"] = true;
    writeFileSync(settingsFile, JSON.stringify(settings));
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ the old plugin cc@cc-agentic is still enabled: two copies of the same hooks would run. Run: claude plugin uninstall cc@cc-agentic\n",
    );
    // Disabled (false) is no clash.
    settings.enabledPlugins["cc@cc-agentic"] = false;
    writeFileSync(settingsFile, JSON.stringify(settings));
    expect(run(["doctor"]).stdout).not.toContain("cc@cc-agentic");
  });

  /** The old plugin's state folder: the old `setup` ran on this machine. */
  function oldSetupRan(configDir: string) {
    mkdirSync(join(configDir, "cc-agentic", "backups"), { recursive: true });
  }

  test("old plugin leftovers with a launcher that runs: restore with it first, then uninstall, then remove the marketplace", () => {
    const { configDir, binDir, settingsFile, run } = setup();
    run(["setup"]);
    oldSetupRan(configDir);
    const oldLauncher = join(binDir, "cc-agentic");
    writeFileSync(oldLauncher, '#!/bin/sh\necho "cc-agentic 0.1.0"\n');
    chmodSync(oldLauncher, 0o755);
    const settings = readJson(settingsFile);
    settings.enabledPlugins["cc@cc-agentic"] = true;
    settings.extraKnownMarketplaces["cc-agentic"] = { autoUpdate: true };
    writeFileSync(settingsFile, JSON.stringify(settings));
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ the old plugin cc@cc-agentic (before 0.2.0) left the plugin enabled, its launcher ~/.local/bin/cc-agentic, extraKnownMarketplaces.cc-agentic in ~/.claude/settings.json. Run `cc-agentic restore` first, then `claude plugin uninstall cc@cc-agentic`, then `claude plugin marketplace remove cc-agentic`.\n",
    );
  });

  test("old plugin leftovers with a launcher that cannot run: the two things to remove by hand, then uninstall and remove", () => {
    const { configDir, binDir, run } = setup();
    run(["setup"]);
    oldSetupRan(configDir);
    // The launcher is there but fails (its plugin is gone); the marketplace is still known.
    const oldLauncher = join(binDir, "cc-agentic");
    writeFileSync(oldLauncher, "#!/bin/sh\necho 'cc-agentic is not installed' >&2\nexit 1\n");
    chmodSync(oldLauncher, 0o755);
    const known = join(configDir, "plugins", "known_marketplaces.json");
    writeFileSync(
      known,
      JSON.stringify({
        ...readJson(known),
        "cc-agentic": { source: { repo: "example-org/cc-agentic", source: "github" } },
      }),
    );
    const installed = join(configDir, "plugins", "installed_plugins.json");
    const plugins = readJson(installed);
    plugins.plugins["cc@cc-agentic"] = [{ installPath: "/gone", scope: "user", version: "0.1.0" }];
    writeFileSync(installed, JSON.stringify(plugins));
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      '✗ the old plugin cc@cc-agentic (before 0.2.0) left the plugin installed, its launcher ~/.local/bin/cc-agentic, the cc-agentic marketplace. Its launcher cannot run, so remove by hand ~/.local/bin/cc-agentic and "cc-agentic" under extraKnownMarketplaces in ~/.claude/settings.json; then run `claude plugin uninstall cc@cc-agentic`, then `claude plugin marketplace remove cc-agentic`.\n',
    );
  });

  test("the old state folder with nothing else left: no line", () => {
    const { configDir, run } = setup();
    run(["setup"]);
    oldSetupRan(configDir);
    expect(run(["doctor"]).stdout).not.toContain("cc-agentic");
  });

  test("another plugin named anymodel is enabled: ✗, exit 1", () => {
    const { settingsFile, run } = setup();
    run(["setup"]);
    const settings = readJson(settingsFile);
    settings.enabledPlugins["anymodel@someone-else"] = true;
    writeFileSync(settingsFile, JSON.stringify(settings));
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ another plugin named anymodel is enabled: anymodel@someone-else",
    );
  });
});

describe("anymodel version and help", () => {
  test("version prints the plugin version", () => {
    expect(setup().run(["version"]).stdout).toBe(`anymodel ${VERSION}\n`);
  });

  test("an unknown command prints help and exits 2", () => {
    const result = setup().run(["nope"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown command: nope");
  });
});

describe("anymodel setup --statusline, statusline and usage", () => {
  test("--statusline sets the status line as an owned key; restore removes it", () => {
    const { settingsFile, run } = setup();
    const result = run(["setup", "--statusline"]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      '~ ~/.claude/settings.json: statusLine: (none) -> {"command":"',
    );
    const line = readJson(settingsFile).statusLine;
    expect(line.type).toBe("command");
    expect(line.command).toEndWith("/.local/bin/anymodel statusline");
    expect(run(["restore", "--yes"]).exitCode).toBe(0);
    expect(readJson(settingsFile)).not.toHaveProperty("statusLine");
  });

  test("in a terminal: asked only after the read-only pass; a no is remembered; --statusline still sets it", async () => {
    const quiet = spyOn(console, "log").mockImplementation(() => undefined);
    const loud = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { home, configDir, stateDir, settingsFile } = setup();
      const paths = cliPaths({ CLAUDE_CONFIG_DIR: configDir, HOME: home });
      const asked: string[] = [];
      const say = (answer: boolean) => (question: string) => {
        asked.push(question);
        return answer;
      };
      // A key someone else set stops setup before the question.
      const settings = readJson(settingsFile);
      writeFileSync(
        settingsFile,
        JSON.stringify({
          ...settings,
          extraKnownMarketplaces: {
            anymodel: { ...settings.extraKnownMarketplaces.anymodel, autoUpdate: false },
          },
        }),
      );
      await expect(runSetup(paths, { confirm: say(true), dryRun: false })).rejects.toThrow(
        "set by someone else",
      );
      expect(asked).toEqual([]);
      writeFileSync(settingsFile, JSON.stringify(settings));
      // A "no": not set, and remembered.
      expect(await runSetup(paths, { confirm: say(false), dryRun: false })).toBe(0);
      expect(asked).toHaveLength(1);
      expect(readJson(settingsFile)).not.toHaveProperty("statusLine");
      expect(readFileSync(join(stateDir, "statusline-declined"), "utf8")).toBe("no\n");
      // Not asked again.
      expect(await runSetup(paths, { confirm: say(true), dryRun: false })).toBe(0);
      expect(asked).toHaveLength(1);
      expect(readJson(settingsFile)).not.toHaveProperty("statusLine");
      // `--statusline` sets it all the same.
      expect(await runSetup(paths, { confirm: say(false), dryRun: false, statusline: true })).toBe(
        0,
      );
      expect(asked).toHaveLength(1);
      expect(readJson(settingsFile).statusLine.command).toEndWith(
        "/.local/bin/anymodel statusline",
      );
    } finally {
      quiet.mockRestore();
      loud.mockRestore();
    }
  });

  test("--statusline never replaces a status line someone else set", () => {
    const { settingsFile, run } = setup();
    const settings = readJson(settingsFile);
    writeFileSync(
      settingsFile,
      JSON.stringify({ ...settings, statusLine: { command: "my-line", type: "command" } }),
    );
    const result = run(["setup", "--statusline"]);
    expect(result.exitCode).toBe(1);
    expect(readJson(settingsFile).statusLine).toEqual({ command: "my-line", type: "command" });
    // Without the option and without a terminal, setup does not ask and leaves it alone.
    expect(run(["setup"]).exitCode).toBe(0);
    expect(readJson(settingsFile).statusLine).toEqual({ command: "my-line", type: "command" });
  });

  test("statusline reads Claude Code's JSON on stdin and the router's state file", () => {
    const { home, configDir } = setup();
    const guard = subprocessGuard();
    const now = Math.floor(Date.now() / 1000);
    mkdirSync(join(home, ".local", "state", "anymodel"), { recursive: true });
    writeFileSync(
      join(home, ".local", "state", "anymodel", "gateway-state.json"),
      JSON.stringify({
        fallbacks: {
          "anymodel-judge": {
            lastAt: Date.now(),
            model: "claude-sonnet-5",
            resetsAt: null,
            since: Date.now(),
            target: "omniroute:m1",
          },
        },
        limits: {},
        version: 1,
      }),
    );
    const result = Bun.spawnSync(["bun", ...guard.args, CLI, "statusline"], {
      env: { CLAUDE_CONFIG_DIR: configDir, HOME: home, PATH: process.env.PATH ?? "", ...guard.env },
      stdin: new Blob([
        JSON.stringify({
          model: { display_name: "Opus 5.5" },
          rate_limits: { five_hour: { resets_at: now + 3600, used_percentage: 40 } },
        }),
      ]),
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe(
      "Opus 5.5 · judge: fallback active (omniroute:m1) · 5h 40%\n",
    );
  });

  test("usage reads the projects folder; a wrong option exits 2", () => {
    const { configDir, run } = setup();
    const folder = join(configDir, "projects", "-home-user-my-app", "session-1", "subagents");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "agent-a.meta.json"), JSON.stringify({ model: "sonnet" }));
    writeFileSync(
      join(folder, "agent-a.jsonl"),
      `${JSON.stringify({
        cwd: "/home/user/my-app",
        message: {
          content: [{ text: "secret words", type: "text" }],
          id: "m1",
          model: "glm-5.3-flash",
        },
        timestamp: new Date().toISOString(),
        type: "assistant",
      })}\n`,
    );
    const result = run(["usage", "--hours", "1"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "Claude Code replies in the last 1 h, main sessions and subagents apart, from ~/.claude/projects (read only; no message text)",
        "",
        "/home/user/my-app  session session-",
        "  main session, replies by model: none in the window",
        "  1 subagents, launched as: sonnet 1",
        "  subagent replies by model: glm-5.3-flash 1",
        "  subagents on Opus: 0 of 1 replies (0%)",
        "",
        "Main sessions: 0 sessions; replies by model: none",
        "Subagents: 1 in 1 session; replies by model: glm-5.3-flash 1; on Opus: 0 of 1 replies (0%)",
        "",
      ].join("\n"),
    );
    expect(result.stdout).not.toContain("secret words");
    const wrong = run(["usage", "--days", "1"]);
    expect(wrong.exitCode).toBe(2);
    expect(wrong.stderr).toStartWith("Unknown option: --days");
  });
});
