import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { MARKETPLACE_SOURCE, VERSION } from "../build-info";
import { installLauncher } from "../setup/launcher";
import { listBackups } from "../setup/write";
import { subprocessGuard } from "../testing/port-guard";
import { git, tempDir } from "../testing/temp";

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");

interface SetupOptions {
  marketplace?: boolean;
  gitOk?: boolean;
  /** The marketplace source in known_marketplaces.json. Default: github example-org/anymodel. */
  source?: Record<string, string>;
  /** The version in the marketplace's local copy. Default: VERSION. null: no manifest there. */
  marketplaceVersion?: string | null;
  /**
   * The companion plugins (claude-mem, frontend-design) as `claude plugin install` leaves
   * them when their marketplaces were added first. Default: there. false: neither the
   * marketplaces nor the plugins.
   */
  companions?: boolean;
  /** A fake `claude` on PATH that logs each call. Default: true. */
  claude?: boolean;
  /** The fake git first on PATH. Default: true. false: the real git (a real project). */
  fakeGit?: boolean;
}

/** The companions' marketplaces, as Claude Code lists them once added. */
const COMPANION_MARKETPLACES = {
  thedotmack: { source: { source: "github", repo: "thedotmack/claude-mem" } },
  "claude-plugins-official": {
    source: { source: "github", repo: "anthropics/claude-plugins-official" },
  },
};

/** A temp HOME as it looks right after `claude plugin install anymodel@anymodel`. */
function setup(options: SetupOptions = {}) {
  const home = tempDir("cli");
  const configDir = join(home, ".claude");
  const stateDir = join(configDir, "anymodel");
  const settingsFile = join(configDir, "settings.json");
  mkdirSync(configDir, { recursive: true });
  const companions = options.companions !== false;
  const settings: Record<string, unknown> = {
    model: "opus",
    enabledPlugins: {
      "anymodel@anymodel": true,
      ...(companions && {
        "claude-mem@thedotmack": true,
        "frontend-design@claude-plugins-official": true,
      }),
    },
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
  const plugins: Record<string, unknown> = {
    "anymodel@anymodel": [{ scope: "user", installPath, version: VERSION }],
  };
  if (companions) {
    const memPath = join(configDir, "plugins", "cache", "thedotmack", "claude-mem", "13.39.0");
    const designPath = join(configDir, "plugins", "cache", "official", "frontend-design", "abc");
    mkdirSync(memPath, { recursive: true });
    mkdirSync(designPath, { recursive: true });
    plugins["claude-mem@thedotmack"] = [
      { scope: "user", installPath: memPath, version: "13.39.0" },
    ];
    plugins["frontend-design@claude-plugins-official"] = [
      { scope: "user", installPath: designPath, version: "8f814f49002f" },
    ];
  }
  writeFileSync(
    join(configDir, "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins }),
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
      ...(companions && COMPANION_MARKETPLACES),
    }),
  );

  // A fake git first on PATH, so doctor's access check never reaches the network.
  // It logs each call, has no core.sshCommand, and fails ls-remote when gitOk is false.
  const fakeBin = join(home, "fake-bin");
  const gitLog = join(home, "git-calls.log");
  mkdirSync(fakeBin);
  if (options.fakeGit !== false) {
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
  }
  // A fake claude that logs each call (setup runs `claude plugin …`), and package tools
  // that know no Warp: no test reaches a real one.
  const claudeLog = join(home, "claude-calls.log");
  const fakes: Record<string, string> = { "dpkg-query": "exit 1", rpm: "exit 1", brew: "exit 1" };
  if (options.claude !== false) {
    fakes.claude = `echo "$*" >> ${JSON.stringify(claudeLog)}\nexit 0`;
  }
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(join(fakeBin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(fakeBin, name), 0o755);
  }

  const env: Record<string, string> = {
    HOME: home,
    CLAUDE_CONFIG_DIR: configDir,
    PATH: `${fakeBin}:${join(home, ".local", "bin")}:${process.env.PATH ?? ""}`,
  };
  const run = (args: string[], extraEnv: Record<string, string> = {}, cwd = home) => {
    // The live-router guard runs in the CLI too: no test may reach port 20100.
    const guard = subprocessGuard();
    const result = Bun.spawnSync([process.execPath, ...guard.args, CLI, ...args], {
      cwd,
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
  /** Like `run`, without blocking this process: a fake server here can answer the CLI. */
  const runAsync = async (args: string[]) => {
    const guard = subprocessGuard();
    const child = Bun.spawn([process.execPath, ...guard.args, CLI, ...args], {
      cwd: home,
      env: { ...env, ...guard.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, stdout, stderr };
  };
  const gitCalls = () => (existsSync(gitLog) ? readFileSync(gitLog, "utf8") : "");
  const claudeCalls = () => (existsSync(claudeLog) ? readFileSync(claudeLog, "utf8") : "");
  return {
    home,
    configDir,
    stateDir,
    settingsFile,
    binDir: join(home, ".local", "bin"),
    launcher: join(home, ".local", "bin", "anymodel"),
    fakeBin,
    run,
    runAsync,
    gitCalls,
    claudeCalls,
  };
}

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("anymodel setup", () => {
  test("installs the launcher and turns on auto-update, keeping the other settings", () => {
    const { settingsFile, launcher, run, claudeCalls } = setup();
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    // The companions are there already: claude is not run.
    expect(claudeCalls()).toBe("");
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
      enabledPlugins: {
        "anymodel@anymodel": true,
        "claude-mem@thedotmack": true,
        "frontend-design@claude-plugins-official": true,
      },
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
        "Dry run: nothing was written or run.",
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
    settings.extraKnownMarketplaces.anymodel.autoUpdate = false;
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
    // Setup asked git about the project it ran in (none: the fake knows no repo).
    const afterSetup = gitCalls().length;
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
        "✓ claude-mem@thedotmack 13.39.0 is installed and on",
        "✓ frontend-design@claude-plugins-official 8f814f49002f is installed and on",
        // Warp is optional too.
        "· Warp: not installed (optional: anymodel setup --warp)",
        // The gateway is optional: never set up is information, not a failure.
        "· gateway: not set up (optional). To use it: anymodel gateway setup",
        "",
      ].join("\n"),
    );
    expect(result.exitCode).toBe(0);
    // git is asked for the user's own ssh command, then told never to ask for a password.
    expect(gitCalls().slice(afterSetup)).toBe(
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

describe("anymodel setup: the companion plugins", () => {
  test("their marketplaces are not added: setup adds each, which installs the plugin", () => {
    const { run, claudeCalls, launcher } = setup({ companions: false });
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "+ marketplace thedotmack (thedotmack/claude-mem), which installs claude-mem@thedotmack",
        "+ marketplace claude-plugins-official (anthropics/claude-plugins-official), which installs frontend-design@claude-plugins-official",
        "+ ~/.local/bin/anymodel: launcher created",
        "~ ~/.claude/settings.json: extraKnownMarketplaces.anymodel.autoUpdate: (none) -> true",
        "Done. Each changed file has a backup in ~/.claude/anymodel/backups/.",
        "",
      ].join("\n"),
    );
    expect(claudeCalls()).toBe(
      [
        "plugin marketplace add thedotmack/claude-mem",
        "plugin marketplace add anthropics/claude-plugins-official",
        "",
      ].join("\n"),
    );
    expect(existsSync(launcher)).toBe(true);
  });

  test("a marketplace that is there, with its plugin gone: setup installs the plugin", () => {
    const { configDir, run, claudeCalls } = setup();
    const installed = join(configDir, "plugins", "installed_plugins.json");
    const plugins = readJson(installed);
    delete plugins.plugins["claude-mem@thedotmack"];
    writeFileSync(installed, JSON.stringify(plugins));
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("+ plugin claude-mem@thedotmack\n");
    expect(claudeCalls()).toBe("plugin install claude-mem@thedotmack\n");
  });

  test("a companion the person turned off stays off; setup says how to turn it on", () => {
    const { settingsFile, run, claudeCalls } = setup();
    const settings = readJson(settingsFile);
    settings.enabledPlugins["claude-mem@thedotmack"] = false;
    writeFileSync(settingsFile, JSON.stringify(settings));
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "! claude-mem@thedotmack is turned off, and anymodel does not load without it. Run: claude plugin enable claude-mem@thedotmack\n",
    );
    expect(claudeCalls()).toBe("");
    expect(readJson(settingsFile).enabledPlugins["claude-mem@thedotmack"]).toBe(false);
  });

  test("--dry-run lists the claude steps and runs none", () => {
    const { run, claudeCalls, stateDir } = setup({ companions: false });
    const result = run(["setup", "--dry-run"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toStartWith(
      "+ marketplace thedotmack (thedotmack/claude-mem), which installs claude-mem@thedotmack\n",
    );
    expect(result.stdout).toEndWith("Dry run: nothing was written or run.\n");
    expect(claudeCalls()).toBe("");
    expect(existsSync(stateDir)).toBe(false);
  });

  test("a claude step that fails: Claude Code's words, exit 1; the next step and the files still done", () => {
    const { fakeBin, run, launcher } = setup({ companions: false });
    writeFileSync(
      join(fakeBin, "claude"),
      "#!/bin/sh\necho 'clone failed: no network' >&2\nexit 1\n",
    );
    const result = run(["setup"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "! claude plugin marketplace add thedotmack/claude-mem failed (exit 1): clone failed: no network\n" +
        "! claude plugin marketplace add anthropics/claude-plugins-official failed (exit 1): clone failed: no network\n",
    );
    expect(existsSync(launcher)).toBe(true);
  });

  test("no claude on PATH: setup names the steps and stops before it writes anything", () => {
    const { fakeBin, run, launcher, stateDir } = setup({ companions: false, claude: false });
    const result = run(["setup"], { PATH: `${fakeBin}:${dirname(process.execPath)}` });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      [
        "The claude command is not on PATH. Setup needs it for these steps:",
        "  $ claude plugin marketplace add thedotmack/claude-mem",
        "  $ claude plugin marketplace add anthropics/claude-plugins-official",
        "",
      ].join("\n"),
    );
    expect(existsSync(launcher)).toBe(false);
    expect(existsSync(stateDir)).toBe(false);
  });
});

describe("anymodel doctor: the companion plugins", () => {
  test("not added, turned off, or outside the range: one ✗ each, with what to run", () => {
    const missing = setup({ companions: false });
    missing.run(["setup"]);
    const none = missing.run(["doctor"]);
    expect(none.exitCode).toBe(1);
    expect(none.stdout).toContain(
      "✗ the thedotmack marketplace is not added, so claude-mem@thedotmack is missing and anymodel does not load. Run: anymodel setup\n" +
        "✗ the claude-plugins-official marketplace is not added, so frontend-design@claude-plugins-official is missing and anymodel does not load. Run: anymodel setup\n",
    );

    const { configDir, settingsFile, run } = setup();
    run(["setup"]);
    const settings = readJson(settingsFile);
    settings.enabledPlugins["frontend-design@claude-plugins-official"] = false;
    writeFileSync(settingsFile, JSON.stringify(settings));
    const installed = join(configDir, "plugins", "installed_plugins.json");
    const plugins = readJson(installed);
    plugins.plugins["claude-mem@thedotmack"][0].version = "13.28.0";
    writeFileSync(installed, JSON.stringify(plugins));
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ claude-mem@thedotmack 13.28.0 is outside >=13.29.0. Run: claude plugin update claude-mem@thedotmack\n" +
        "✗ frontend-design@claude-plugins-official is turned off, and anymodel does not load without it. Run: claude plugin enable frontend-design@claude-plugins-official\n",
    );
  });

  test("a version resolved from a git tag carries a commit suffix; the range is checked without it", () => {
    const { configDir, run } = setup();
    run(["setup"]);
    const installed = join(configDir, "plugins", "installed_plugins.json");
    const plugins = readJson(installed);
    plugins.plugins["claude-mem@thedotmack"][0].version = "13.30.0-8713c5b11005";
    writeFileSync(installed, JSON.stringify(plugins));
    expect(run(["doctor"]).stdout).toContain(
      "✓ claude-mem@thedotmack 13.30.0-8713c5b11005 is installed and on\n",
    );
  });
});

/** A git project with a `.claude/anymodel.json`. */
function project(config: unknown): string {
  const dir = tempDir("project");
  git(dir, "init", "-q");
  mkdirSync(join(dir, ".claude"));
  writeFileSync(join(dir, ".claude", "anymodel.json"), JSON.stringify(config));
  return dir;
}

/** The real git, with no config of the machine's. */
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };

describe("anymodel setup: the auto-mode block", () => {
  const RULE = "In my-app: never touch the production database.";

  test("no terminal: the entries are shown, left out, and not written", () => {
    const repo = project({ autoMode: [RULE] });
    const { settingsFile, run } = setup({ fakeGit: false });
    const result = run(["setup"], GIT_ENV, repo);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toStartWith(
      [
        `Auto mode: trust rules from ${repo}/.claude/anymodel.json ("autoMode"), for autoMode.environment in ~/.claude/settings.json:`,
        '  + "$defaults"',
        `  + ${JSON.stringify(RULE)}`,
        "",
      ].join("\n"),
    );
    expect(result.stdout).toContain(
      "! auto-mode entries left out: they are trust rules, so setup asks first. Run anymodel setup in a terminal, or with --yes.\n",
    );
    expect(readJson(settingsFile).autoMode).toBeUndefined();
  });

  test("--yes: added after the person's own entries, owned; restore takes out only ours", () => {
    const repo = project({ autoMode: [RULE] });
    const { settingsFile, run } = setup({ fakeGit: false });
    const settings = readJson(settingsFile);
    settings.autoMode = { environment: ["$defaults", "Mine: github.com/example-org"] };
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    const result = run(["setup", "--yes"], GIT_ENV, repo);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `~ ~/.claude/settings.json: autoMode.environment: added ${JSON.stringify(RULE)}\n`,
    );
    expect(readJson(settingsFile).autoMode).toEqual({
      environment: ["$defaults", "Mine: github.com/example-org", RULE],
    });
    expect(run(["restore"]).exitCode).toBe(0);
    expect(readJson(settingsFile).autoMode).toEqual({
      environment: ["$defaults", "Mine: github.com/example-org"],
    });
  });

  test("--project from another folder; no list yet: it starts with $defaults; a second run changes nothing", () => {
    const repo = project({ autoMode: [RULE] });
    const { settingsFile, run } = setup({ fakeGit: false });
    expect(run(["setup", "--yes", "--project", repo], GIT_ENV).exitCode).toBe(0);
    expect(readJson(settingsFile).autoMode).toEqual({ environment: ["$defaults", RULE] });
    const again = run(["setup", "--project", repo], GIT_ENV);
    expect(again.stdout).toBe("Nothing to change. Setup is up to date.\n");
    run(["restore"]);
    expect(readJson(settingsFile).autoMode).toBeUndefined();
  });

  test("the project changes its rules: the next setup shows and makes exactly that change", () => {
    const repo = project({ autoMode: [RULE, "In my-app: old rule."] });
    const { settingsFile, run } = setup({ fakeGit: false });
    run(["setup", "--yes"], GIT_ENV, repo);
    writeFileSync(
      join(repo, ".claude", "anymodel.json"),
      JSON.stringify({ autoMode: [RULE, "In my-app: new rule."] }),
    );
    const result = run(["setup", "--yes"], GIT_ENV, repo);
    expect(result.stdout).toContain('  + "In my-app: new rule."\n  - "In my-app: old rule."\n');
    expect(readJson(settingsFile).autoMode.environment).toEqual([
      "$defaults",
      RULE,
      "In my-app: new rule.",
    ]);
  });

  test("--dry-run: the entries as changes, nothing asked, nothing written", () => {
    const repo = project({ autoMode: [RULE] });
    const { settingsFile, stateDir, run } = setup({ fakeGit: false });
    const result = run(["setup", "--dry-run"], GIT_ENV, repo);
    expect(result.stdout).toContain(
      `~ ~/.claude/settings.json: autoMode.environment: added "$defaults"\n~ ~/.claude/settings.json: autoMode.environment: added ${JSON.stringify(RULE)}\n`,
    );
    expect(result.stdout).not.toContain("left out");
    expect(readJson(settingsFile).autoMode).toBeUndefined();
    expect(existsSync(stateDir)).toBe(false);
  });

  test("an invalid anymodel.json stops setup before anything is written", () => {
    const repo = project({ autoMode: "not a list" });
    const { launcher, run } = setup({ fakeGit: false });
    const result = run(["setup", "--yes"], GIT_ENV, repo);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("anymodel.json: autoMode:");
    expect(existsSync(launcher)).toBe(false);
  });
});

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/** A made-up backend key: it must never show in any output. */
const PLANTED_KEY = "sk-planted-SECRET-0123456789abcdef";
const CHEAP_MODEL = "ollama-cloud/deepseek-v4.1-flash";

/** A fake OpenAI-style backend: `/v1/models` lists the cheap model, or answers `status`. */
function fakeBackend(status = 200) {
  const seen: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req): Response {
      seen.push(`${new URL(req.url).pathname} ${req.headers.get("authorization")}`);
      if (status !== 200) return new Response("no", { status });
      return Response.json({ data: [{ id: CHEAP_MODEL }] });
    },
  });
  servers.push(server);
  return { url: `http://127.0.0.1:${server.port}`, seen };
}

/** gateway.json with the omniroute backend at `url`, as `gateway setup` makes it. */
function writeGatewayConfig(home: string, url: string) {
  const file = join(home, ".config", "anymodel", "gateway.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      backends: { omniroute: { apiKey: PLANTED_KEY, baseUrl: url } },
      slots: {
        "anymodel-scout": [`omniroute:${CHEAP_MODEL}`, "claude-sonnet-5-5"],
        "anymodel-worker": [`omniroute:${CHEAP_MODEL}`, "claude-sonnet-5-5"],
      },
    }),
    { mode: 0o600 },
  );
}

/** claude-mem's settings.json as claude-mem seeds it on its first run (the keys that matter). */
const SEEDED = {
  CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
  CLAUDE_MEM_PROVIDER: "claude",
  CLAUDE_MEM_OPENAI_COMPAT_PRESET: "",
  CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "",
  CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "",
  CLAUDE_MEM_OPENAI_COMPAT_MODEL: "",
  CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "claude",
  CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "",
  CLAUDE_MEM_CONTEXT_OBSERVATIONS: "50",
};

function writeClaudeMem(home: string, settings: unknown): string {
  const file = join(home, ".claude-mem", "settings.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings, null, 2), { mode: 0o600 });
  return file;
}

describe("anymodel setup: claude-mem on the gateway's cheap model", () => {
  test("claude-mem's defaults become the cheap model, with Claude Haiku as the fallback; the key never shows; restore takes them out", async () => {
    const { home, run, runAsync } = setup();
    const backend = fakeBackend();
    writeGatewayConfig(home, backend.url);
    const file = writeClaudeMem(home, SEEDED);
    const result = await runAsync(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      [
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_PROVIDER: "claude" -> "openai-compatible"',
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_PRESET: "" -> "custom"',
        `~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "" -> "${backend.url}/v1"`,
        `~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_MODEL: "" -> "${CHEAP_MODEL}"`,
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "" -> "••••cdef"',
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "" -> "claude-haiku-4-5-20251001"',
        "",
      ].join("\n"),
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain(PLANTED_KEY);
    // The key was checked against the backend once, before anything was written.
    expect(backend.seen).toEqual([`/v1/models Bearer ${PLANTED_KEY}`]);
    expect(readJson(file)).toEqual({
      ...SEEDED,
      CLAUDE_MEM_PROVIDER: "openai-compatible",
      CLAUDE_MEM_OPENAI_COMPAT_PRESET: "custom",
      CLAUDE_MEM_OPENAI_COMPAT_API_KEY: PLANTED_KEY,
      CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: `${backend.url}/v1`,
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: CHEAP_MODEL,
      CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "claude-haiku-4-5-20251001",
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);

    // A second run: nothing to change, and no need to ask the backend again.
    expect(run(["setup"]).stdout).toBe("Nothing to change. Setup is up to date.\n");
    expect(backend.seen).toHaveLength(1);

    // Restore takes out the keys setup owns: claude-mem falls back to its own defaults.
    const restored = run(["restore"]);
    expect(`${restored.stdout}${restored.stderr}`).not.toContain(PLANTED_KEY);
    expect(readJson(file)).toEqual({
      CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
      CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "claude",
      CLAUDE_MEM_CONTEXT_OBSERVATIONS: "50",
    });
  });

  test("the person chose another provider: every claude-mem key is left alone, said once", () => {
    const { home, run } = setup();
    const backend = fakeBackend();
    writeGatewayConfig(home, backend.url);
    const file = writeClaudeMem(home, { ...SEEDED, CLAUDE_MEM_PROVIDER: "gemini" });
    const before = readFileSync(file, "utf8");
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      '  claude-mem settings left alone: CLAUDE_MEM_PROVIDER is "gemini" in ~/.claude-mem/settings.json (your choice)\n',
    );
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(backend.seen).toEqual([]);
  });

  test("another key of the person's: left alone, and the key is not printed", () => {
    const { home, run } = setup();
    writeGatewayConfig(home, fakeBackend().url);
    writeClaudeMem(home, {
      ...SEEDED,
      CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "sk-their-own-key-0000000000",
    });
    const result = run(["setup"]);
    expect(result.stdout).toContain(
      "  claude-mem settings left alone: CLAUDE_MEM_OPENAI_COMPAT_API_KEY is another key in ~/.claude-mem/settings.json (your choice)\n",
    );
    expect(result.stdout).not.toContain("sk-their-own-key");
  });

  test("the backend refuses the key: nothing written to claude-mem's settings", async () => {
    const { home, runAsync } = setup();
    writeGatewayConfig(home, fakeBackend(401).url);
    const file = writeClaudeMem(home, SEEDED);
    const before = readFileSync(file, "utf8");
    const result = await runAsync(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "! claude-mem settings left alone: omniroute refused its key (HTTP 401)\n",
    );
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("claude-mem never ran yet: its settings file is made with the seven keys, mode 600", async () => {
    const { home, run, runAsync } = setup();
    const backend = fakeBackend();
    writeGatewayConfig(home, backend.url);
    expect((await runAsync(["setup"])).exitCode).toBe(0);
    const file = join(home, ".claude-mem", "settings.json");
    expect(readJson(file)).toEqual({
      CLAUDE_MEM_PROVIDER: "openai-compatible",
      CLAUDE_MEM_OPENAI_COMPAT_PRESET: "custom",
      CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: `${backend.url}/v1`,
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: CHEAP_MODEL,
      CLAUDE_MEM_OPENAI_COMPAT_API_KEY: PLANTED_KEY,
      CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "claude",
      CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "claude-haiku-4-5-20251001",
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    run(["restore"]);
    expect(existsSync(file)).toBe(false);
  });

  test("an older file with claude-mem's keys under env: they are set there", async () => {
    const { home, runAsync } = setup();
    writeGatewayConfig(home, fakeBackend().url);
    const file = writeClaudeMem(home, { env: SEEDED, theme: "dark" });
    await runAsync(["setup"]);
    const written = readJson(file);
    expect(written.theme).toBe("dark");
    expect(written.env.CLAUDE_MEM_PROVIDER).toBe("openai-compatible");
    expect(written.CLAUDE_MEM_PROVIDER).toBeUndefined();
  });

  test("claude-mem older than 13.29.0: a note, and nothing written", () => {
    const { home, configDir, run } = setup();
    writeGatewayConfig(home, fakeBackend().url);
    const file = writeClaudeMem(home, SEEDED);
    const installed = join(configDir, "plugins", "installed_plugins.json");
    const plugins = readJson(installed);
    plugins.plugins["claude-mem@thedotmack"][0].version = "13.28.0";
    writeFileSync(installed, JSON.stringify(plugins));
    const before = readFileSync(file, "utf8");
    const result = run(["setup"]);
    expect(result.stdout).toContain(
      "! claude-mem settings left alone: claude-mem 13.28.0 is older than 13.29.0, which brought what they need. Run: claude plugin update claude-mem@thedotmack\n",
    );
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("no gateway: claude-mem's settings are not touched, and nothing is said", () => {
    const { home, run } = setup();
    const file = writeClaudeMem(home, SEEDED);
    const before = readFileSync(file, "utf8");
    expect(run(["setup"]).stdout).not.toContain("claude-mem");
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

describe("anymodel setup: options", () => {
  test("--warp and --remove-warp together, a --project with no folder, or one that is not there: exit 2", () => {
    const { run } = setup();
    expect(run(["setup", "--warp", "--remove-warp"]).exitCode).toBe(2);
    expect(run(["setup", "--project"]).exitCode).toBe(2);
    expect(run(["setup", "--project", "/no/such/folder"]).exitCode).toBe(2);
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
