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
import { versionStampFile } from "../setup/instructions";
import { installLauncher } from "../setup/launcher";
import { listBackups } from "../setup/write";
import { subprocessGuard } from "../testing/port-guard";
import { tempDir } from "../testing/temp";
import { anymodelImports } from "./doctor";

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
  // The CLI runs in the temp HOME, never in this repo: doctor reads the CLAUDE.md files of
  // the current folder and the folders above it.
  const run = (args: string[], extraEnv: Record<string, string> = {}, cwd = home) => {
    // The live-router guard runs in the CLI too: no test may reach port 20100.
    const guard = subprocessGuard();
    const result = Bun.spawnSync(["bun", ...guard.args, CLI, ...args], {
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

/** What a first setup prints for the instructions: the plugin's real files, then the block. */
const INSTRUCTIONS_CREATED = [
  "+ ~/.claude/anymodel/instructions/core.md: created",
  "+ ~/.claude/anymodel/instructions/optin/worktrees.md: created",
  "+ ~/.claude/CLAUDE.md: created, with the anymodel block",
];

/** The block setup writes into ~/.claude/CLAUDE.md. */
const BLOCK = [
  "<!-- anymodel:begin -->",
  "<!-- Written by anymodel setup. `anymodel setup --no-instructions` takes it out. -->",
  "@~/.claude/anymodel/instructions/core.md",
  "<!-- anymodel:end -->",
].join("\n");

const PLUGIN_INSTRUCTIONS = join(import.meta.dir, "..", "..", "plugin", "instructions");

/** What setup prints when it stores `--no-instructions`, and when `--instructions` clears it. */
const OPT_OUT_STORED =
  "+ ~/.claude/anymodel/no-instructions: setup leaves the instructions out from now on (`anymodel setup --instructions` brings them back)";
const OPT_OUT_CLEARED =
  "- ~/.claude/anymodel/no-instructions: removed: setup installs the instructions again";

/** doctor's line for instructions that are in place. */
const INSTRUCTIONS_OK =
  "✓ the instructions copy ~/.claude/anymodel/instructions/ is this version's, and ~/.claude/CLAUDE.md imports it";

describe("anymodel setup", () => {
  test("installs the launcher and turns on auto-update, keeping the other settings", () => {
    const { settingsFile, launcher, run } = setup();
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "+ ~/.local/bin/anymodel: launcher created",
        "~ ~/.claude/settings.json: extraKnownMarketplaces.anymodel.autoUpdate: (none) -> true",
        ...INSTRUCTIONS_CREATED,
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
    expect(readdirSync(configDir).sort()).toEqual([
      "CLAUDE.md",
      "anymodel",
      "plugins",
      "settings.json",
    ]);
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
        ...INSTRUCTIONS_CREATED,
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

describe("anymodel setup: the instructions", () => {
  test("a copy of the plugin's files, imported by a block after the user's own text", () => {
    const { configDir, stateDir, run } = setup();
    const claudeMd = join(configDir, "CLAUDE.md");
    writeFileSync(claudeMd, "# My notes\n\nAnswer in short sentences.\n");
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("~ ~/.claude/CLAUDE.md: anymodel block added\n");
    expect(readFileSync(claudeMd, "utf8")).toBe(
      `# My notes\n\nAnswer in short sentences.\n\n${BLOCK}\n`,
    );
    const copy = join(stateDir, "instructions");
    expect(readFileSync(join(copy, "core.md"), "utf8")).toBe(
      readFileSync(join(PLUGIN_INSTRUCTIONS, "core.md"), "utf8"),
    );
    expect(readFileSync(join(copy, "optin", "worktrees.md"), "utf8")).toBe(
      readFileSync(join(PLUGIN_INSTRUCTIONS, "optin", "worktrees.md"), "utf8"),
    );
  });

  test("a setup refreshes a copy someone edited, and changes nothing else", () => {
    const { stateDir, run } = setup();
    run(["setup"]);
    writeFileSync(join(stateDir, "instructions", "core.md"), "# Edited by hand\n");
    const result = run(["setup"]);
    expect(result.stdout).toBe(
      [
        "~ ~/.claude/anymodel/instructions/core.md: updated",
        "Done. Each changed file has a backup in ~/.claude/anymodel/backups/.",
        "",
      ].join("\n"),
    );
  });

  test("--no-instructions on a fresh machine: no copy, no CLAUDE.md", () => {
    const { configDir, stateDir, run } = setup();
    const result = run(["setup", "--no-instructions"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "+ ~/.local/bin/anymodel: launcher created",
        "~ ~/.claude/settings.json: extraKnownMarketplaces.anymodel.autoUpdate: (none) -> true",
        OPT_OUT_STORED,
        "Done. Each changed file has a backup in ~/.claude/anymodel/backups/.",
        "",
      ].join("\n"),
    );
    expect(existsSync(join(configDir, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(stateDir, "instructions"))).toBe(false);
  });

  test("--no-instructions after a setup takes them out and keeps the user's text", () => {
    const { configDir, stateDir, run } = setup();
    const claudeMd = join(configDir, "CLAUDE.md");
    writeFileSync(claudeMd, "# My notes\n");
    run(["setup"]);
    const dry = run(["setup", "--no-instructions", "--dry-run"]);
    const expected = [
      OPT_OUT_STORED,
      "~ ~/.claude/CLAUDE.md: anymodel block removed",
      "- ~/.claude/anymodel/instructions/core.md: removed",
      "- ~/.claude/anymodel/instructions/optin/worktrees.md: removed",
    ];
    expect(dry.stdout).toBe([...expected, "Dry run: nothing was written.", ""].join("\n"));
    expect(readFileSync(claudeMd, "utf8")).toContain(BLOCK);

    const result = run(["setup", "--no-instructions"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        ...expected,
        "Done. Each changed file has a backup in ~/.claude/anymodel/backups/.",
        "",
      ].join("\n"),
    );
    expect(readFileSync(claudeMd, "utf8")).toBe("# My notes\n");
    expect(existsSync(join(stateDir, "instructions"))).toBe(false);
    expect(run(["setup", "--no-instructions"]).stdout).toBe(
      "Nothing to change. Setup is up to date.\n",
    );
  });

  test("restore removes the copy and the block; the user's text stays", () => {
    const { configDir, stateDir, run } = setup();
    const claudeMd = join(configDir, "CLAUDE.md");
    writeFileSync(claudeMd, "# My notes\n");
    run(["setup"]);
    const result = run(["restore"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("~ ~/.claude/CLAUDE.md: removed the anymodel block");
    expect(readFileSync(claudeMd, "utf8")).toBe("# My notes\n");
    expect(existsSync(join(stateDir, "instructions"))).toBe(false);
  });

  test("--no-instructions is kept: a later plain setup leaves them out", () => {
    const { configDir, stateDir, run } = setup();
    run(["setup"]);
    run(["setup", "--no-instructions"]);
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Nothing to change. Setup is up to date.\n");
    expect(existsSync(join(configDir, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(stateDir, "instructions"))).toBe(false);
  });

  test("--instructions opts back in: the choice is cleared and they are installed", () => {
    const { stateDir, run } = setup();
    run(["setup", "--no-instructions"]);
    const dry = run(["setup", "--instructions", "--dry-run"]);
    expect(dry.stdout).toBe(
      [OPT_OUT_CLEARED, ...INSTRUCTIONS_CREATED, "Dry run: nothing was written.", ""].join("\n"),
    );
    expect(existsSync(join(stateDir, "no-instructions"))).toBe(true);
    const result = run(["setup", "--instructions"]);
    expect(result.stdout).toBe(
      [
        OPT_OUT_CLEARED,
        ...INSTRUCTIONS_CREATED,
        "Done. Each changed file has a backup in ~/.claude/anymodel/backups/.",
        "",
      ].join("\n"),
    );
    expect(run(["setup"]).stdout).toBe("Nothing to change. Setup is up to date.\n");
  });

  test("--instructions and --no-instructions together are refused with exit 2", () => {
    const { stateDir, run } = setup();
    const result = run(["setup", "--instructions", "--no-instructions"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toStartWith("Use --no-instructions or --instructions, not both.\n");
    expect(existsSync(stateDir)).toBe(false);
  });

  test("restore forgets --no-instructions: the next setup installs them", () => {
    const { stateDir, run } = setup();
    run(["setup", "--no-instructions"]);
    const result = run(["restore"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "- ~/.claude/anymodel/no-instructions: removed (your --no-instructions choice; the next setup installs the instructions)\n",
    );
    expect(existsSync(join(stateDir, "no-instructions"))).toBe(false);
    expect(run(["setup"]).stdout).toContain(INSTRUCTIONS_CREATED.join("\n"));
  });

  test("setup stamps the copy with this plugin's version", () => {
    const { stateDir, run } = setup();
    run(["setup"]);
    expect(readFileSync(versionStampFile(stateDir), "utf8")).toBe(`${VERSION}\n`);
  });

  test("an unknown setup option is refused with exit 2, and nothing is written", () => {
    const { stateDir, run } = setup();
    const result = run(["setup", "--no-instruction"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toStartWith("Unknown option: --no-instruction\n");
    expect(existsSync(stateDir)).toBe(false);
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
        INSTRUCTIONS_OK,
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

describe("anymodel doctor: the instructions", () => {
  /** doctor's lines, without the ones for other checks. */
  const instructionLines = (stdout: string) =>
    stdout.split("\n").filter((line) => /instructions|CLAUDE\.md/.test(line));

  test("left out by choice: information, not a failure", () => {
    const { run } = setup();
    run(["setup", "--no-instructions"]);
    const result = run(["doctor"]);
    expect(instructionLines(result.stdout)).toEqual([
      "· instructions: left out (anymodel setup --no-instructions). To add them: anymodel setup --instructions",
    ]);
    expect(result.exitCode).toBe(0);
  });

  test("never installed: ✗ with the setup command", () => {
    const { run } = setup();
    expect(instructionLines(run(["doctor"]).stdout)).toEqual([
      "✗ the instructions are not installed in ~/.claude/anymodel/instructions/. Run: anymodel setup",
    ]);
  });

  test("a copy someone edited: ✗ naming the file, exit 1", () => {
    const { stateDir, run } = setup();
    run(["setup"]);
    writeFileSync(join(stateDir, "instructions", "core.md"), "# Edited by hand\n");
    const result = run(["doctor"]);
    expect(instructionLines(result.stdout)).toEqual([
      "✗ the instructions copy ~/.claude/anymodel/instructions/ is not this plugin version's (core.md differs). Run: anymodel setup",
    ]);
    expect(result.exitCode).toBe(1);
  });

  test("a copy another plugin version wrote: ✗ naming that version, exit 1", () => {
    const { stateDir, run } = setup();
    run(["setup"]);
    writeFileSync(versionStampFile(stateDir), "0.0.1\n");
    const result = run(["doctor"]);
    expect(instructionLines(result.stdout)).toEqual([
      "✗ the instructions copy ~/.claude/anymodel/instructions/ is not this plugin version's (written by 0.0.1). Run: anymodel setup",
    ]);
    expect(result.exitCode).toBe(1);
  });

  test("the block was taken out of CLAUDE.md by hand: ✗ with the setup command", () => {
    const { configDir, run } = setup();
    run(["setup"]);
    writeFileSync(join(configDir, "CLAUDE.md"), "# Mine\n");
    expect(instructionLines(run(["doctor"]).stdout)).toEqual([
      "✗ ~/.claude/CLAUDE.md does not import the instructions (its anymodel block is missing or changed). Run: anymodel setup",
    ]);
  });
});

describe("anymodel doctor: a project's imports of anymodel files", () => {
  /** A project folder in the temp HOME whose CLAUDE.md (or .claude/CLAUDE.md) holds `text`. */
  function project(home: string, text: string, where = "CLAUDE.md") {
    const dir = join(home, "my-app");
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, where), text);
    // doctor runs one folder below: Claude Code reads the memory files of every folder above.
    const sub = join(dir, "src");
    mkdirSync(sub);
    return sub;
  }
  const projectLines = (stdout: string) =>
    stdout.split("\n").filter((line) => line.includes("imports ~/"));

  test("an imported anymodel file that is there: ✓", () => {
    const { home, run } = setup();
    run(["setup"]);
    const cwd = project(home, "# My app\n\n@~/.claude/anymodel/instructions/optin/worktrees.md\n");
    const result = run(["doctor"], {}, cwd);
    expect(projectLines(result.stdout)).toEqual([
      "✓ the project's CLAUDE.md imports ~/.claude/anymodel/instructions/optin/worktrees.md, and it is there",
    ]);
    expect(result.exitCode).toBe(0);
  });

  test("a missing one: ✗, it loads nothing, exit 1", () => {
    const { home, run } = setup();
    const cwd = project(
      home,
      "@~/.claude/anymodel/instructions/optin/worktrees.md\n",
      join(".claude", "CLAUDE.md"),
    );
    const result = run(["doctor"], {}, cwd);
    expect(projectLines(result.stdout)).toEqual([
      "✗ ~/my-app/.claude/CLAUDE.md imports ~/.claude/anymodel/instructions/optin/worktrees.md, which is missing: it loads nothing. Run: anymodel setup",
    ]);
    expect(result.exitCode).toBe(1);
  });

  test("missing after --no-instructions: information, with the command to add them", () => {
    const { home, run } = setup();
    run(["setup", "--no-instructions"]);
    const cwd = project(home, "@~/.claude/anymodel/instructions/optin/worktrees.md\n");
    const result = run(["doctor"], {}, cwd);
    expect(projectLines(result.stdout)).toEqual([
      "· ~/my-app/CLAUDE.md imports ~/.claude/anymodel/instructions/optin/worktrees.md, which is missing: it loads nothing while the instructions are left out here. To add them: anymodel setup --instructions",
    ]);
    expect(result.exitCode).toBe(0);
  });

  test("no anymodel import: no line", () => {
    const { home, run } = setup();
    run(["setup"]);
    const cwd = project(home, "# My app\n\n@docs/rules.md\n");
    expect(projectLines(run(["doctor"], {}, cwd).stdout)).toEqual([]);
  });
});

describe("anymodelImports", () => {
  test("@~/ and @/ paths into an anymodel instructions copy, outside code", () => {
    const fence = "`".repeat(3);
    const text = [
      "@~/.claude/anymodel/instructions/optin/worktrees.md",
      "See @/home/user/.claude/anymodel/instructions/core.md for more.",
      "@docs/rules.md and @~/notes.md are not anymodel's.",
      "In code: `see @~/.claude/anymodel/instructions/a.md` is not an import.",
      "an@~/.claude/anymodel/instructions/b.md is not one either",
      fence,
      "@~/.claude/anymodel/instructions/c.md",
      fence,
    ].join("\n");
    expect(anymodelImports(text)).toEqual([
      "~/.claude/anymodel/instructions/optin/worktrees.md",
      "/home/user/.claude/anymodel/instructions/core.md",
    ]);
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
