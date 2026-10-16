import { afterEach, describe, expect, spyOn, test } from "bun:test";
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
import { type Machine, TEST_HOST_VAR } from "../machine/machine";
import { MCP_VERSIONS } from "../mcp/versions";
import { versionStampFile } from "../setup/instructions";
import { installLauncher } from "../setup/launcher";
import { listBackups } from "../setup/write";
import { subprocessGuard } from "../testing/port-guard";
import { git, tempDir } from "../testing/temp";
import { ccSmartDevKitImports, runDoctor } from "./doctor";
import { cliPaths } from "./paths";
import { type SetupOptions as RunSetupOptions, runSetup } from "./setup";

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");

interface SetupOptions {
  marketplace?: boolean;
  gitOk?: boolean;
  /** The marketplace source in known_marketplaces.json. Default: github example-org/cc-smart-dev-kit. */
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

/** A temp HOME as it looks right after `claude plugin install cc-smart-dev-kit@cc-smart-dev-kit`. */
function setup(options: SetupOptions = {}) {
  const home = tempDir("cli");
  const configDir = join(home, ".claude");
  const stateDir = join(configDir, "cc-smart-dev-kit");
  const settingsFile = join(configDir, "settings.json");
  mkdirSync(configDir, { recursive: true });
  const companions = options.companions !== false;
  const settings: Record<string, unknown> = {
    model: "opus",
    enabledPlugins: {
      "cc-smart-dev-kit@cc-smart-dev-kit": true,
      ...(companions && {
        "claude-mem@thedotmack": true,
        "frontend-design@claude-plugins-official": true,
      }),
    },
  };
  if (options.marketplace !== false) {
    settings.extraKnownMarketplaces = {
      "cc-smart-dev-kit": { source: { source: "github", repo: "example-org/cc-smart-dev-kit" } },
    };
  }
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);

  // The installed plugin: its dist/cli.js is this CLI's source, so the launcher runs real code.
  const installPath = join(
    configDir,
    "plugins",
    "cache",
    "cc-smart-dev-kit",
    "cc-smart-dev-kit",
    VERSION,
  );
  mkdirSync(join(installPath, "dist"), { recursive: true });
  writeFileSync(join(installPath, "dist", "cli.js"), `await import(${JSON.stringify(CLI)});\n`);
  const plugins: Record<string, unknown> = {
    "cc-smart-dev-kit@cc-smart-dev-kit": [{ scope: "user", installPath, version: VERSION }],
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
  const installLocation = join(configDir, "plugins", "marketplaces", "cc-smart-dev-kit");
  const marketplaceVersion =
    options.marketplaceVersion === undefined ? VERSION : options.marketplaceVersion;
  if (marketplaceVersion !== null) {
    mkdirSync(join(installLocation, "plugin", ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(installLocation, "plugin", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "cc-smart-dev-kit", version: marketplaceVersion }),
    );
  }
  writeFileSync(
    join(configDir, "plugins", "known_marketplaces.json"),
    JSON.stringify({
      "cc-smart-dev-kit": {
        source: options.source ?? { source: "github", repo: "example-org/cc-smart-dev-kit" },
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
  } else {
    // The real git, alone: the rest of the host's PATH stays out.
    const realGit = Bun.which("git");
    if (realGit === null) throw new Error("this test needs git");
    symlinkSync(realGit, join(fakeBin, "git"));
  }
  // A fake claude that logs each call (setup runs `claude plugin …`), and package tools
  // that know no Warp: no test reaches a real one. `claude mcp …` is emulated for real —
  // Claude Code writes the user-scope servers into `<config dir>/.claude.json` under
  // `mcpServers` (seen live, 2.1.301) — so a second setup finds what the first registered.
  const claudeLog = join(home, "claude-calls.log");
  const fakes: Record<string, string> = { "dpkg-query": "exit 1", rpm: "exit 1", brew: "exit 1" };
  if (options.claude !== false) {
    const mcpHelper = join(fakeBin, "fake-claude-mcp.js");
    writeFileSync(mcpHelper, FAKE_CLAUDE_MCP_JS);
    fakes.claude = [
      `echo "$*" >> ${JSON.stringify(claudeLog)}`,
      `[ "$1" = mcp ] && exec bun ${JSON.stringify(mcpHelper)} "$@"`,
      "exit 0",
    ].join("\n");
  }
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(join(fakeBin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(fakeBin, name), 0o755);
  }

  // The CLI runs as its own process: it never reads the host. PATH holds the fakes, the
  // launcher's folder and bun's, nothing else; the host's facts are given (a Linux with no
  // os-release, so no package manager cc-smart-dev-kit knows, and no Warp app).
  const env: Record<string, string> = {
    HOME: home,
    CLAUDE_CONFIG_DIR: configDir,
    PATH: `${fakeBin}:${join(home, ".local", "bin")}:${dirname(process.execPath)}`,
    [TEST_HOST_VAR]: JSON.stringify({
      platform: "linux",
      arch: "x64",
      osRelease: null,
      macApp: join(home, "no-such-Warp.app"),
    }),
  };
  // The CLI runs in the temp HOME, never in this repo: doctor reads the CLAUDE.md files of
  // the current folder and the folders above it.
  const run = (args: string[], extraEnv: Record<string, string> = {}, cwd = home) => {
    // The live-router guard runs in the CLI too: no test may reach port 20100.
    const guard = subprocessGuard();
    const result = Bun.spawnSync([process.execPath, ...guard.args, CLI, ...args], {
      // Outside any project by default: doctor also checks the project of the folder it
      // runs in, and a test that wants one passes its own `cwd`.
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
  /**
   * The `claude plugin …` calls only: the MCP registrations (`claude mcp …`) are asserted
   * where they belong (§ MCP servers), so a test about the companions or Warp does not have
   * to carry them.
   */
  const pluginCalls = () =>
    claudeCalls()
      .split("\n")
      .filter((line) => !line.startsWith("mcp ") && line !== "")
      .join("\n");
  return {
    home,
    configDir,
    stateDir,
    settingsFile,
    binDir: join(home, ".local", "bin"),
    launcher: join(home, ".local", "bin", "cc-smart-dev-kit"),
    fakeBin,
    run,
    runAsync,
    gitCalls,
    claudeCalls,
    pluginCalls,
  };
}

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

/**
 * The fake `claude mcp` (run by the fake `claude` on PATH): it emulates Claude Code's own
 * writes, so setup's registration, doctor's check and restore's removal are exercised for
 * real — user-scope servers live in `<config dir>/.claude.json` under `mcpServers`.
 */
const FAKE_CLAUDE_MCP_JS = `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const file = join(process.env.CLAUDE_CONFIG_DIR ?? join(process.env.HOME ?? "", ".claude"), ".claude.json");
const read = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
const argv = process.argv.slice(2);
const verb = argv[1];
const rest = argv.slice(2);
if (verb === "add-json") {
  const name = rest[rest.length - 2];
  const config = JSON.parse(rest[rest.length - 1]);
  const all = read();
  if (all.mcpServers?.[name] !== undefined) {
    console.error("MCP server " + name + " already exists in user config");
    process.exit(1);
  }
  writeFileSync(file, JSON.stringify({ ...all, mcpServers: { ...all.mcpServers, [name]: config } }, null, 2));
  console.log("Added stdio MCP server " + name + " to user config");
  process.exit(0);
}
if (verb === "remove") {
  const name = rest[0];
  const all = read();
  if (all.mcpServers?.[name] === undefined) {
    console.error("No MCP server found with name: " + name);
    process.exit(1);
  }
  delete all.mcpServers[name];
  writeFileSync(file, JSON.stringify(all, null, 2));
  console.log("Removed MCP server " + name);
  process.exit(0);
}
if (verb === "get") {
  const name = rest[0];
  const config = read().mcpServers?.[name];
  if (config === undefined) {
    console.error("No MCP server found with name: " + name);
    process.exit(1);
  }
  console.log(name + ":");
  console.log("  Scope: User config (available in all your projects)");
  console.log("  Status: ✔ Connected");
  console.log("  Type: " + (config.type ?? "stdio"));
  process.exit(0);
}
process.exit(0);
`;

/**
 * For setup or doctor run in this process: a Linux with no package manager cc-smart-dev-kit knows,
 * no Warp app and no command on PATH, so nothing of the host this test runs on is read.
 */
function noHostMachine(home: string, confirm: Machine["confirm"]): Machine {
  return {
    run: () => ({ exitCode: 1, output: "" }),
    runOnTerminal: () => 1,
    which: () => null,
    confirm,
    platform: "linux",
    arch: "x64",
    osRelease: () => null,
    macApp: join(home, "no-such-Warp.app"),
    exists: () => false,
    fetchText: () => Promise.reject(new Error("no network in this test")),
  };
}

/** Plain `cc-smart-dev-kit setup` in this process, in `home`, asking with `confirm`. */
function setupOptions(
  home: string,
  confirm: Machine["confirm"],
  extra: Partial<RunSetupOptions> = {},
): RunSetupOptions {
  return {
    dryRun: false,
    yes: false,
    warp: false,
    removeWarp: false,
    project: home,
    machine: noHostMachine(home, confirm),
    instructions: null,
    instructionsSource: PLUGIN_INSTRUCTIONS,
    serenaSource: PLUGIN_SERENA,
    statusline: false,
    // No environment of its own: a test that wants a key sets one through `extra`.
    env: {},
    ...extra,
  };
}

/** What a first setup prints for the instructions: the plugin's real files, then the block. */
const INSTRUCTIONS_CREATED = [
  "+ ~/.claude/cc-smart-dev-kit/instructions/core.md: created",
  "+ ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: created",
  "+ ~/.claude/CLAUDE.md: created, with the cc-smart-dev-kit block",
];

/**
 * The MCP servers setup registers, as it prints them: the three that need no key, then the
 * context Serena is started with. Tavily is left out without a key (`TAVILY_SKIPPED`).
 */
const MCP_REGISTERED = [
  "+ MCP server playwright registered for your user",
  "+ MCP server serena registered for your user",
  "+ MCP server sequential-thinking registered for your user",
];
const SERENA_CONTEXT =
  "+ ~/.local/share/cc-smart-dev-kit/serena/contexts/worktree.yml: Serena's context (project switching on)";
const TAVILY_SKIPPED =
  "! tavily-websearch: skipped — no TAVILY_API_KEY in the environment, and no key file: put the key there (chmod 600) or set the variable, then run setup again";

/** The `claude mcp add-json` lines a dry run prints, written by hand from `home`. */
function mcpDryRunLines(home: string): string[] {
  const launcher = join(home, ".local", "bin", "cc-smart-dev-kit");
  const context = join(
    home,
    ".local",
    "share",
    "cc-smart-dev-kit",
    "serena",
    "contexts",
    "worktree.yml",
  );
  return [
    `$ claude mcp add-json --scope user playwright {"command":"${launcher}","args":["browser","mcp"]}`,
    `$ claude mcp add-json --scope user serena {"args":["--from","git+https://github.com/oraios/serena@${MCP_VERSIONS.serena}","serena","start-mcp-server","--context","${context}","--open-web-dashboard","False","--project-from-cwd"],"command":"uvx","timeout":300000}`,
    `$ claude mcp add-json --scope user sequential-thinking {"args":["-y","@modelcontextprotocol/server-sequential-thinking@${MCP_VERSIONS.sequentialThinking}"],"command":"bunx"}`,
  ];
}

/** doctor's information line for the Tavily server on a machine with no key. */
const tavilyDoctorSkipped = (home: string): string =>
  `· the Tavily MCP server is skipped: no TAVILY_API_KEY in the environment, and no key file: put the key there (chmod 600) or set the variable, then run setup again (key file: ${join(home, ".claude", "cc-smart-dev-kit", "tavily.key")})`;

/** doctor's lines for the MCP servers, after a setup registered them. */
const MCP_DOCTOR_OK = [
  '✓ MCP server "playwright": Connected',
  '✓ MCP server "serena": Connected',
  '✓ MCP server "sequential-thinking": Connected',
];

/** The block setup writes into ~/.claude/CLAUDE.md. */
const BLOCK = [
  "<!-- cc-smart-dev-kit:begin -->",
  "<!-- Written by cc-smart-dev-kit setup. `cc-smart-dev-kit setup --no-instructions` takes it out. -->",
  "@~/.claude/cc-smart-dev-kit/instructions/core.md",
  "<!-- cc-smart-dev-kit:end -->",
].join("\n");

const PLUGIN_INSTRUCTIONS = join(import.meta.dir, "..", "..", "plugin", "instructions");

/** The plugin's real `serena` folder: setup installs its context as it does for a person. */
const PLUGIN_SERENA = join(import.meta.dir, "..", "..", "plugin", "serena");

/** What setup prints when it stores `--no-instructions`, and when `--instructions` clears it. */
const OPT_OUT_STORED =
  "+ ~/.claude/cc-smart-dev-kit/no-instructions: setup leaves the instructions out from now on (`cc-smart-dev-kit setup --instructions` brings them back)";
const OPT_OUT_CLEARED =
  "- ~/.claude/cc-smart-dev-kit/no-instructions: removed: setup installs the instructions again";

/** doctor's line for instructions that are in place. */
const INSTRUCTIONS_OK =
  "✓ the instructions copy ~/.claude/cc-smart-dev-kit/instructions/ is this version's, and ~/.claude/CLAUDE.md imports it";

describe("cc-smart-dev-kit setup", () => {
  test("installs the launcher and turns on auto-update, keeping the other settings", () => {
    const { settingsFile, launcher, run, pluginCalls } = setup();
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    // The companions are there already: no `claude plugin …` step runs.
    expect(pluginCalls()).toBe("");
    expect(result.stdout).toBe(
      [
        ...MCP_REGISTERED,
        "+ ~/.local/bin/cc-smart-dev-kit: launcher created",
        '~ ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> true',
        SERENA_CONTEXT,
        ...INSTRUCTIONS_CREATED,
        TAVILY_SKIPPED,
        "Done. Each changed file has a backup in ~/.claude/cc-smart-dev-kit/backups/.",
        "",
      ].join("\n"),
    );
    expect(existsSync(launcher)).toBe(true);
    expect(readJson(settingsFile)).toEqual({
      model: "opus",
      enabledPlugins: {
        "cc-smart-dev-kit@cc-smart-dev-kit": true,
        "claude-mem@thedotmack": true,
        "frontend-design@claude-plugins-official": true,
      },
      extraKnownMarketplaces: {
        "cc-smart-dev-kit": {
          source: { source: "github", repo: "example-org/cc-smart-dev-kit" },
          autoUpdate: true,
        },
      },
    });
  });

  test("the backups go into the state folder, never beside the files", () => {
    const { configDir, stateDir, settingsFile, binDir, run } = setup();
    run(["setup"]);
    expect(listBackups(stateDir, settingsFile)).toHaveLength(1);
    expect(readdirSync(binDir)).toEqual(["cc-smart-dev-kit"]);
    expect(readdirSync(configDir).sort()).toEqual([
      // Claude Code's own user-scope config: the fake `claude mcp add-json` writes it.
      ".claude.json",
      "CLAUDE.md",
      "cc-smart-dev-kit",
      "plugins",
      "settings.json",
    ]);
  });

  test("a second run changes nothing", () => {
    const { stateDir, settingsFile, run } = setup();
    run(["setup"]);
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`Nothing to change. Setup is up to date.\n${TAVILY_SKIPPED}\n`);
    expect(listBackups(stateDir, settingsFile)).toHaveLength(1);
  });

  test("--dry-run prints the changes and writes nothing at all: no state folder, no lock", () => {
    const { home, stateDir, settingsFile, run } = setup();
    const before = readFileSync(settingsFile, "utf8");
    const result = run(["setup", "--dry-run"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        ...mcpDryRunLines(home),
        "+ ~/.local/bin/cc-smart-dev-kit: launcher created",
        '~ ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> true',
        SERENA_CONTEXT,
        ...INSTRUCTIONS_CREATED,
        TAVILY_SKIPPED,
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
    settings.extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate = false;
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    const before = readFileSync(settingsFile, "utf8");
    const result = run(["setup"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate is false, set by someone else.',
    );
    expect(readFileSync(settingsFile, "utf8")).toBe(before);
    expect(existsSync(launcher)).toBe(false);
    expect(existsSync(stateDir)).toBe(false);
  });

  test("auto-update turned off by the person after setup: theirs now; setup stops, restore leaves it", () => {
    const { settingsFile, launcher, run } = setup();
    run(["setup"]);
    const settings = readJson(settingsFile);
    settings.extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate = false;
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    const result = run(["setup"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate is false: it was changed after cc-smart-dev-kit set it, so it is your choice now.',
    );
    expect(readJson(settingsFile).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBe(
      false,
    );
    expect(run(["restore"]).exitCode).toBe(0);
    expect(readJson(settingsFile).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBe(
      false,
    );
    expect(existsSync(launcher)).toBe(false);
  });

  test("nothing to change, with a line of information: 'Nothing to change' first, and no 'Done'", () => {
    const { settingsFile, run } = setup();
    run(["setup"]);
    // The person's own auto-update key, with the value cc-smart-dev-kit wants: not cc-smart-dev-kit's.
    const ownedFile = join(dirname(settingsFile), "cc-smart-dev-kit", "owned.json");
    writeFileSync(ownedFile, "{}\n");
    const result = run(["setup"]);
    expect(result.stdout).toBe(
      [
        "Nothing to change. Setup is up to date.",
        '  ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: already set by someone else; left alone',
        TAVILY_SKIPPED,
        "",
      ].join("\n"),
    );
  });

  test("a note when ~/.local/bin is not on PATH, and none when it is", () => {
    const { run } = setup();
    expect(run(["setup"]).stdout).not.toContain("Note:");
    const withoutBin = run(["setup"], { PATH: process.env.PATH ?? "" });
    expect(withoutBin.stdout).toContain(
      "Note: ~/.local/bin is not on your PATH. Add it, so the cc-smart-dev-kit command works.",
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

describe("cc-smart-dev-kit setup: the instructions", () => {
  test("a copy of the plugin's files, imported by a block after the user's own text", () => {
    const { configDir, stateDir, run } = setup();
    const claudeMd = join(configDir, "CLAUDE.md");
    writeFileSync(claudeMd, "# My notes\n\nAnswer in short sentences.\n");
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("~ ~/.claude/CLAUDE.md: cc-smart-dev-kit block added\n");
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
        "~ ~/.claude/cc-smart-dev-kit/instructions/core.md: updated",
        TAVILY_SKIPPED,
        "Done. Each changed file has a backup in ~/.claude/cc-smart-dev-kit/backups/.",
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
        ...MCP_REGISTERED,
        "+ ~/.local/bin/cc-smart-dev-kit: launcher created",
        '~ ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> true',
        SERENA_CONTEXT,
        OPT_OUT_STORED,
        TAVILY_SKIPPED,
        "Done. Each changed file has a backup in ~/.claude/cc-smart-dev-kit/backups/.",
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
      "~ ~/.claude/CLAUDE.md: cc-smart-dev-kit block removed",
      "- ~/.claude/cc-smart-dev-kit/instructions/core.md: removed",
      "- ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: removed",
    ];
    expect(dry.stdout).toBe(
      [...expected, TAVILY_SKIPPED, "Dry run: nothing was written or run.", ""].join("\n"),
    );
    expect(readFileSync(claudeMd, "utf8")).toContain(BLOCK);

    const result = run(["setup", "--no-instructions"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        ...expected,
        TAVILY_SKIPPED,
        "Done. Each changed file has a backup in ~/.claude/cc-smart-dev-kit/backups/.",
        "",
      ].join("\n"),
    );
    expect(readFileSync(claudeMd, "utf8")).toBe("# My notes\n");
    expect(existsSync(join(stateDir, "instructions"))).toBe(false);
    expect(run(["setup", "--no-instructions"]).stdout).toBe(
      `Nothing to change. Setup is up to date.\n${TAVILY_SKIPPED}\n`,
    );
  });

  test("restore removes the copy and the block; the user's text stays", () => {
    const { configDir, stateDir, run } = setup();
    const claudeMd = join(configDir, "CLAUDE.md");
    writeFileSync(claudeMd, "# My notes\n");
    run(["setup"]);
    const result = run(["restore"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("~ ~/.claude/CLAUDE.md: removed the cc-smart-dev-kit block");
    expect(readFileSync(claudeMd, "utf8")).toBe("# My notes\n");
    expect(existsSync(join(stateDir, "instructions"))).toBe(false);
  });

  test("--no-instructions is kept: a later plain setup leaves them out", () => {
    const { configDir, stateDir, run } = setup();
    run(["setup"]);
    run(["setup", "--no-instructions"]);
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`Nothing to change. Setup is up to date.\n${TAVILY_SKIPPED}\n`);
    expect(existsSync(join(configDir, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(stateDir, "instructions"))).toBe(false);
  });

  test("--instructions opts back in: the choice is cleared and they are installed", () => {
    const { stateDir, run } = setup();
    run(["setup", "--no-instructions"]);
    const dry = run(["setup", "--instructions", "--dry-run"]);
    expect(dry.stdout).toBe(
      [
        OPT_OUT_CLEARED,
        ...INSTRUCTIONS_CREATED,
        TAVILY_SKIPPED,
        "Dry run: nothing was written or run.",
        "",
      ].join("\n"),
    );
    expect(existsSync(join(stateDir, "no-instructions"))).toBe(true);
    const result = run(["setup", "--instructions"]);
    expect(result.stdout).toBe(
      [
        OPT_OUT_CLEARED,
        ...INSTRUCTIONS_CREATED,
        TAVILY_SKIPPED,
        "Done. Each changed file has a backup in ~/.claude/cc-smart-dev-kit/backups/.",
        "",
      ].join("\n"),
    );
    expect(run(["setup"]).stdout).toBe(
      `Nothing to change. Setup is up to date.\n${TAVILY_SKIPPED}\n`,
    );
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
      "- ~/.claude/cc-smart-dev-kit/no-instructions: removed (your --no-instructions choice; the next setup installs the instructions)\n",
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

describe("cc-smart-dev-kit doctor", () => {
  test("all green after setup, through the launcher; git reads the marketplace over SSH", () => {
    const { home, run, gitCalls } = setup();
    run(["setup"]);
    // Setup asked git about the project it ran in (none: the fake knows no repo).
    const afterSetup = gitCalls().length;
    const result = run(["doctor"]);
    expect(result.stdout).toBe(
      [
        // The bun running the tests: the preload stops one older than 1.4.3.
        `✓ Bun ${Bun.version} at ${process.execPath} (cc-smart-dev-kit needs ≥ 1.4.3)`,
        `✓ cc-smart-dev-kit@cc-smart-dev-kit ${VERSION} is installed at ~/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/${VERSION}`,
        `✓ the installed version ${VERSION} is not behind the marketplace`,
        `✓ the launcher ~/.local/bin/cc-smart-dev-kit runs cc-smart-dev-kit ${VERSION}`,
        INSTRUCTIONS_OK,
        "✓ can read the marketplace at git@github.com:example-org/cc-smart-dev-kit.git",
        "✓ plugin auto-update is on",
        "✓ plugin updates are not switched off",
        // The self-update has not checked yet: information, not a failure.
        "· background update: no check yet (a new Claude session checks, at most once an hour)",
        "✓ no other enabled plugin is named cc-smart-dev-kit",
        "✓ claude-mem@thedotmack 13.39.0 is installed and on",
        "✓ frontend-design@claude-plugins-official 8f814f49002f is installed and on",
        ...MCP_DOCTOR_OK,
        // Tavily is optional: without a key its server is skipped, never a failure.
        tavilyDoctorSkipped(home),
        // Warp is optional too.
        "· Warp: not installed (optional: cc-smart-dev-kit setup --warp)",
        // The gateway is optional: never set up is information, not a failure.
        "· gateway: not set up (optional). To use it: cc-smart-dev-kit gateway setup",
        "",
      ].join("\n"),
    );
    expect(result.exitCode).toBe(0);
    // git is asked for the user's own ssh command, then told never to ask for a password.
    // Then which project the folder is in (this fake git says: none).
    expect(gitCalls().slice(afterSetup)).toBe(
      [
        "config --get core.sshCommand | prompt=0 | ssh=",
        "ls-remote git@github.com:example-org/cc-smart-dev-kit.git HEAD | prompt=0 | ssh=ssh -o BatchMode=yes -o ConnectTimeout=8",
        "rev-parse --path-format=absolute --show-toplevel --absolute-git-dir --git-common-dir | prompt= | ssh=",
        "",
      ].join("\n"),
    );
  });

  test("tmux: the managed passthrough line, and the fix when the running server does not pass alerts through", () => {
    const { fakeBin, home, run } = setup();
    run(["setup"]);
    // tmux is installed: this fake answers "a server is running" and the option read.
    const tmuxFake = (value: string) =>
      ["#!/bin/sh", `[ "$1" = show-options ] && { echo "${value}"; exit 0; }`, "exit 0", ""].join(
        "\n",
      );
    writeFileSync(join(fakeBin, "tmux"), tmuxFake("allow-passthrough off"));
    chmodSync(join(fakeBin, "tmux"), 0o755);
    const result = run(["doctor"], { TMUX: "/tmp/tmux-1001/default,1234,0" });
    expect(result.exitCode).toBe(0); // information, never a failure
    expect(result.stdout).toContain(
      '· ~/.tmux.conf has no "set -g allow-passthrough all" line, so tmux drops an alert from a pane. To add it: cc-smart-dev-kit setup\n',
    );
    expect(result.stdout).toContain(
      "· tmux: alerts are not passed through (its allow-passthrough is not all). To apply it now: tmux set -g allow-passthrough all (a restart works too); it needs tmux 3.3 or newer\n",
    );

    // The line in place, and the running server on `all`: nothing about tmux at all.
    writeFileSync(join(home, ".tmux.conf"), "set -g allow-passthrough all\n");
    writeFileSync(join(fakeBin, "tmux"), tmuxFake("all"));
    expect(run(["doctor"], { TMUX: "/tmp/tmux-1001/default,1234,0" }).stdout).not.toContain("tmux");

    // Outside tmux the running server is not read: only the config file is checked.
    writeFileSync(join(home, ".tmux.conf"), "");
    expect(
      run(["doctor"], { TMUX: "" })
        .stdout.split("\n")
        .filter((line) => line.includes("tmux")),
    ).toEqual([
      '· ~/.tmux.conf has no "set -g allow-passthrough all" line, so tmux drops an alert from a pane. To add it: cc-smart-dev-kit setup',
    ]);
  });

  test("on a Bun older than 1.4.3: ✗ first, and the gateway checks, which send the key, are skipped", async () => {
    // In this process, to give doctor an older Bun: a local marketplace, so no git runs, and
    // no `setup`, so no launcher: doctor would run it with this process's real HOME.
    const { home, configDir } = setup({
      source: { source: "directory", path: "/placeholder" },
    });
    const marketplace = join(home, "marketplace");
    mkdirSync(marketplace);
    writeFileSync(
      join(configDir, "plugins", "known_marketplaces.json"),
      JSON.stringify({
        "cc-smart-dev-kit": {
          source: { source: "directory", path: marketplace },
          installLocation: join(configDir, "plugins", "marketplaces", "cc-smart-dev-kit"),
        },
      }),
    );
    // A gateway config whose router and backend are this fake: a gateway check would reach it.
    const seen: string[] = [];
    const fake = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        seen.push(new URL(req.url).pathname);
        return Response.json({ data: [] });
      },
    });
    const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: configDir });
    mkdirSync(join(home, ".config", "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(
      paths.gatewayConfigFile,
      JSON.stringify({
        backends: {
          omniroute: { apiKey: "omni_SENTINEL_123456", baseUrl: `http://127.0.0.1:${fake.port}` },
        },
        port: fake.port,
        slots: { "cc-smart-dev-kit-scout": ["omniroute:m1"] },
        version: 1,
      }),
      { mode: 0o600 },
    );
    const ran: string[][] = [];
    // doctor's Warp check reads nothing of the host this test runs on.
    const fakeMachine = noHostMachine(home, null);
    const out: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
      out.push(parts.join(" "));
    });
    let exitCode: number;
    try {
      exitCode = await runDoctor(
        paths,
        {},
        {
          bun: { path: "/opt/bun/bin/bun", version: "1.4.2" },
          gateway: {
            bundle: join(home, "router.js"),
            runner: (cmd) => {
              ran.push(cmd);
              return { exitCode: 0, output: "" };
            },
            systemd: true,
            machine: fakeMachine,
          },
          local: { instructionsSource: join(home, "no-instructions-source"), cwd: home },
          project: null,
          live: null,
        },
      );
    } finally {
      log.mockRestore();
      fake.stop(true);
    }
    expect(out).toEqual([
      "✗ cc-smart-dev-kit needs Bun ≥ 1.4.3; this is 1.4.2 (/opt/bun/bin/bun). Upgrade this Bun, then run: cc-smart-dev-kit doctor",
      `✓ cc-smart-dev-kit@cc-smart-dev-kit ${VERSION} is installed at ~/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/${VERSION}`,
      `✓ the installed version ${VERSION} is not behind the marketplace`,
      "✗ no launcher at ~/.local/bin/cc-smart-dev-kit. Run: cc-smart-dev-kit setup",
      "✗ the instructions are not installed in ~/.claude/cc-smart-dev-kit/instructions/. Run: cc-smart-dev-kit setup",
      "✓ the marketplace folder ~/marketplace exists",
      "✗ plugin auto-update is off in ~/.claude/settings.json. Run: cc-smart-dev-kit setup",
      "✓ plugin updates are not switched off",
      "· background update: no check yet (a new Claude session checks, at most once an hour)",
      "✓ no other enabled plugin is named cc-smart-dev-kit",
      "✓ claude-mem@thedotmack 13.39.0 is installed and on",
      "✓ frontend-design@claude-plugins-official 8f814f49002f is installed and on",
      "· Warp: not installed (optional: cc-smart-dev-kit setup --warp)",
      "· gateway: not checked on this Bun (its checks send the backend key)",
    ]);
    expect(exitCode).toBe(1);
    expect(seen).toEqual([]);
    expect(ran).toEqual([]);
  });

  test("the host is the test's: a macOS with the Warp app (given, not read) is information, and setup leaves Warp alone", () => {
    const { home, run } = setup();
    const macApp = join(home, "Applications", "Warp.app");
    mkdirSync(macApp, { recursive: true });
    const host = {
      [TEST_HOST_VAR]: JSON.stringify({
        platform: "darwin",
        arch: "arm64",
        osRelease: null,
        macApp,
      }),
    };
    const setupResult = run(["setup"], host);
    expect(setupResult.exitCode).toBe(0);
    // No `claude plugin …` step: the companions are there, and this world's claude is a fake.
    expect(setupResult.stdout).toContain("+ MCP server playwright registered for your user\n");
    const result = run(["doctor"], host);
    expect(result.stdout).toContain(
      "· Warp is installed, without its Claude plugin (optional: cc-smart-dev-kit setup --warp)\n",
    );
    expect(result.exitCode).toBe(0);
  });

  test("no access to the marketplace: ✗ naming both URLs tried, exit 1", () => {
    const { run, gitCalls } = setup({ gitOk: false });
    run(["setup"]);
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ cannot read the marketplace (" +
        "git@github.com:example-org/cc-smart-dev-kit.git: fatal: unable to access 'https://***@git.example.com/r.git/': 403; " +
        "https://github.com/example-org/cc-smart-dev-kit.git: fatal: unable to access 'https://***@git.example.com/r.git/': 403). " +
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
      `✗ the cc-smart-dev-kit marketplace is not added. Run: claude plugin marketplace add ${MARKETPLACE_SOURCE}\n`,
    );
  });

  test("the installed version is behind the marketplace: ✗ with the update command", () => {
    const { run } = setup({ marketplaceVersion: "99.0.0" });
    run(["setup"]);
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      `✗ installed ${VERSION}, marketplace has 99.0.0. Run: claude plugin update cc-smart-dev-kit@cc-smart-dev-kit\n`,
    );
  });

  test("the marketplace's local copy has no plugin manifest: ✗ with the marketplace update command", () => {
    const { run } = setup({ marketplaceVersion: null });
    run(["setup"]);
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ cannot read the version in ~/.claude/plugins/marketplaces/cc-smart-dev-kit/plugin/.claude-plugin/plugin.json. " +
        "Run: claude plugin marketplace update cc-smart-dev-kit\n",
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
        `✗ plugin updates are switched off: ${name} (in your environment) is set, so the background update skips them too. ` +
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
      "✗ plugin updates are switched off: DISABLE_UPDATES (in the env of ~/.claude/settings.json) is set, so the background update skips them too. " +
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
      `✓ the launcher ~/.local/bin/cc-smart-dev-kit runs cc-smart-dev-kit ${VERSION}\n`,
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
      `✗ the launcher's bun ${gone} is missing or not executable. Run: cc-smart-dev-kit setup\n`,
    );
  });

  test("a launcher someone edited is out of date", () => {
    const { launcher, run } = setup();
    run(["setup"]);
    writeFileSync(launcher, `${readFileSync(launcher, "utf8")}# edited\n`);
    expect(run(["doctor"]).stdout).toContain(
      "✗ the launcher ~/.local/bin/cc-smart-dev-kit is out of date. Run: cc-smart-dev-kit setup\n",
    );
  });

  test("before setup: no launcher and auto-update off, exit 1", () => {
    const { run } = setup();
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("✗ no launcher at ~/.local/bin/cc-smart-dev-kit");
    expect(result.stdout).toContain("✗ plugin auto-update is off");
  });

  test("not installed: one ✗ for it, and no version line", () => {
    const { configDir, run } = setup();
    rmSync(join(configDir, "plugins", "installed_plugins.json"));
    const result = run(["doctor"]);
    expect(result.stdout).toContain(
      "✗ the cc-smart-dev-kit@cc-smart-dev-kit plugin is not installed. Run: claude plugin install cc-smart-dev-kit@cc-smart-dev-kit\n",
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

  test("another plugin named cc-smart-dev-kit is enabled: ✗, exit 1", () => {
    const { settingsFile, run } = setup();
    run(["setup"]);
    const settings = readJson(settingsFile);
    settings.enabledPlugins["cc-smart-dev-kit@someone-else"] = true;
    writeFileSync(settingsFile, JSON.stringify(settings));
    const result = run(["doctor"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ another plugin named cc-smart-dev-kit is enabled: cc-smart-dev-kit@someone-else",
    );
  });
});

describe("cc-smart-dev-kit doctor: the instructions", () => {
  /** doctor's lines, without the ones for other checks. */
  const instructionLines = (stdout: string) =>
    stdout.split("\n").filter((line) => /instructions|CLAUDE\.md/.test(line));

  test("left out by choice: information, not a failure", () => {
    const { run } = setup();
    run(["setup", "--no-instructions"]);
    const result = run(["doctor"]);
    expect(instructionLines(result.stdout)).toEqual([
      "· instructions: left out (cc-smart-dev-kit setup --no-instructions). To add them: cc-smart-dev-kit setup --instructions",
    ]);
    expect(result.exitCode).toBe(0);
  });

  test("never installed: ✗ with the setup command", () => {
    const { run } = setup();
    expect(instructionLines(run(["doctor"]).stdout)).toEqual([
      "✗ the instructions are not installed in ~/.claude/cc-smart-dev-kit/instructions/. Run: cc-smart-dev-kit setup",
    ]);
  });

  test("a copy someone edited: ✗ naming the file, exit 1", () => {
    const { stateDir, run } = setup();
    run(["setup"]);
    writeFileSync(join(stateDir, "instructions", "core.md"), "# Edited by hand\n");
    const result = run(["doctor"]);
    expect(instructionLines(result.stdout)).toEqual([
      "✗ the instructions copy ~/.claude/cc-smart-dev-kit/instructions/ is not this plugin version's (core.md differs). Run: cc-smart-dev-kit setup",
    ]);
    expect(result.exitCode).toBe(1);
  });

  test("a copy another plugin version wrote: ✗ naming that version, exit 1", () => {
    const { stateDir, run } = setup();
    run(["setup"]);
    writeFileSync(versionStampFile(stateDir), "0.0.1\n");
    const result = run(["doctor"]);
    expect(instructionLines(result.stdout)).toEqual([
      "✗ the instructions copy ~/.claude/cc-smart-dev-kit/instructions/ is not this plugin version's (written by 0.0.1). Run: cc-smart-dev-kit setup",
    ]);
    expect(result.exitCode).toBe(1);
  });

  test("the block was taken out of CLAUDE.md by hand: ✗ with the setup command", () => {
    const { configDir, run } = setup();
    run(["setup"]);
    writeFileSync(join(configDir, "CLAUDE.md"), "# Mine\n");
    expect(instructionLines(run(["doctor"]).stdout)).toEqual([
      "✗ ~/.claude/CLAUDE.md does not import the instructions (its cc-smart-dev-kit block is missing or changed). Run: cc-smart-dev-kit setup",
    ]);
  });
});

describe("cc-smart-dev-kit doctor: a project's imports of cc-smart-dev-kit files", () => {
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

  test("an imported cc-smart-dev-kit file that is there: ✓", () => {
    const { home, run } = setup();
    run(["setup"]);
    const cwd = project(
      home,
      "# My app\n\n@~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md\n",
    );
    const result = run(["doctor"], {}, cwd);
    expect(projectLines(result.stdout)).toEqual([
      "✓ the project's CLAUDE.md imports ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md, and it is there",
    ]);
    expect(result.exitCode).toBe(0);
  });

  test("a missing one: ✗, it loads nothing, exit 1", () => {
    const { home, run } = setup();
    const cwd = project(
      home,
      "@~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md\n",
      join(".claude", "CLAUDE.md"),
    );
    const result = run(["doctor"], {}, cwd);
    expect(projectLines(result.stdout)).toEqual([
      "✗ ~/my-app/.claude/CLAUDE.md imports ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md, which is missing: it loads nothing. Run: cc-smart-dev-kit setup",
    ]);
    expect(result.exitCode).toBe(1);
  });

  test("missing after --no-instructions: information, with the command to add them", () => {
    const { home, run } = setup();
    run(["setup", "--no-instructions"]);
    const cwd = project(home, "@~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md\n");
    const result = run(["doctor"], {}, cwd);
    expect(projectLines(result.stdout)).toEqual([
      "· ~/my-app/CLAUDE.md imports ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md, which is missing: it loads nothing while the instructions are left out here. To add them: cc-smart-dev-kit setup --instructions",
    ]);
    expect(result.exitCode).toBe(0);
  });

  test("no cc-smart-dev-kit import: no line", () => {
    const { home, run } = setup();
    run(["setup"]);
    const cwd = project(home, "# My app\n\n@docs/rules.md\n");
    expect(projectLines(run(["doctor"], {}, cwd).stdout)).toEqual([]);
  });
});

describe("ccSmartDevKitImports", () => {
  test("@~/ and @/ paths into a cc-smart-dev-kit instructions copy, outside code", () => {
    const fence = "`".repeat(3);
    const text = [
      "@~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md",
      "See @/home/user/.claude/cc-smart-dev-kit/instructions/core.md for more.",
      "@docs/rules.md and @~/notes.md are not cc-smart-dev-kit's.",
      "In code: `see @~/.claude/cc-smart-dev-kit/instructions/a.md` is not an import.",
      "an@~/.claude/cc-smart-dev-kit/instructions/b.md is not one either",
      fence,
      "@~/.claude/cc-smart-dev-kit/instructions/c.md",
      fence,
    ].join("\n");
    expect(ccSmartDevKitImports(text)).toEqual([
      "~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md",
      "/home/user/.claude/cc-smart-dev-kit/instructions/core.md",
    ]);
  });
});

describe("cc-smart-dev-kit setup: the companion plugins", () => {
  test("their marketplaces are not added: setup adds each, which installs the plugin", () => {
    const { run, pluginCalls, launcher } = setup({ companions: false });
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        "+ marketplace thedotmack (thedotmack/claude-mem), which installs claude-mem@thedotmack",
        "+ marketplace claude-plugins-official (anthropics/claude-plugins-official), which installs frontend-design@claude-plugins-official",
        ...MCP_REGISTERED,
        "+ ~/.local/bin/cc-smart-dev-kit: launcher created",
        '~ ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> true',
        SERENA_CONTEXT,
        ...INSTRUCTIONS_CREATED,
        TAVILY_SKIPPED,
        "Done. Each changed file has a backup in ~/.claude/cc-smart-dev-kit/backups/.",
        "",
      ].join("\n"),
    );
    // No `claude plugin …` step beyond the two marketplaces: the MCP registrations are
    // `claude mcp …`, asserted in § MCP servers.
    expect(pluginCalls()).toBe(
      [
        "plugin marketplace add thedotmack/claude-mem",
        "plugin marketplace add anthropics/claude-plugins-official",
      ].join("\n"),
    );
    expect(existsSync(launcher)).toBe(true);
  });

  test("a marketplace that is there, with its plugin gone: setup installs the plugin", () => {
    const { configDir, run, pluginCalls } = setup();
    const installed = join(configDir, "plugins", "installed_plugins.json");
    const plugins = readJson(installed);
    delete plugins.plugins["claude-mem@thedotmack"];
    writeFileSync(installed, JSON.stringify(plugins));
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("+ plugin claude-mem@thedotmack\n");
    expect(pluginCalls()).toBe("plugin install claude-mem@thedotmack");
  });

  test("a companion the person turned off stays off; setup says how to turn it on", () => {
    const { settingsFile, run, pluginCalls } = setup();
    const settings = readJson(settingsFile);
    settings.enabledPlugins["claude-mem@thedotmack"] = false;
    writeFileSync(settingsFile, JSON.stringify(settings));
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "! claude-mem@thedotmack is turned off, and cc-smart-dev-kit does not load without it. Run: claude plugin enable claude-mem@thedotmack\n",
    );
    expect(pluginCalls()).toBe("");
    expect(readJson(settingsFile).enabledPlugins["claude-mem@thedotmack"]).toBe(false);
  });

  test("--dry-run lists the claude steps and runs none", () => {
    const { run, pluginCalls, stateDir } = setup({ companions: false });
    const result = run(["setup", "--dry-run"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toStartWith(
      "+ marketplace thedotmack (thedotmack/claude-mem), which installs claude-mem@thedotmack\n",
    );
    expect(result.stdout).toEndWith("Dry run: nothing was written or run.\n");
    expect(pluginCalls()).toBe("");
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

  test("no claude on PATH: setup skips only the claude steps, names them, does the rest; exit 1", () => {
    const { run, launcher, settingsFile } = setup({ companions: false, claude: false });
    const result = run(["setup"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(
      [
        "+ ~/.local/bin/cc-smart-dev-kit: launcher created",
        '~ ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> true',
        SERENA_CONTEXT,
        ...INSTRUCTIONS_CREATED,
        "! The claude command is not on PATH, so setup skipped these steps. Run them once it is:",
        "  $ claude plugin marketplace add thedotmack/claude-mem",
        "  $ claude plugin marketplace add anthropics/claude-plugins-official",
        "! The claude command is not on PATH, so playwright was not registered. Run it once it is.",
        "! The claude command is not on PATH, so serena was not registered. Run it once it is.",
        "! The claude command is not on PATH, so sequential-thinking was not registered. Run it once it is.",
        TAVILY_SKIPPED,
        "Done. Each changed file has a backup in ~/.claude/cc-smart-dev-kit/backups/.",
        "",
      ].join("\n"),
    );
    expect(existsSync(launcher)).toBe(true);
    expect(readJson(settingsFile).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBe(true);
  });

  test("the first run: claude-mem comes with its marketplace, and is pointed at the gateway in the same run", async () => {
    const { home, configDir, fakeBin, runAsync } = setup({ companions: false });
    // Claude Code installs claude-mem when its marketplace is added: the fake does the same.
    const installed = join(configDir, "plugins", "installed_plugins.json");
    const memPath = join(configDir, "plugins", "cache", "thedotmack", "claude-mem", "13.39.0");
    const after = readJson(installed);
    after.plugins["claude-mem@thedotmack"] = [
      { scope: "user", installPath: memPath, version: "13.39.0" },
    ];
    const afterFile = join(home, "installed-after.json");
    writeFileSync(afterFile, JSON.stringify(after));
    writeFileSync(
      join(fakeBin, "claude"),
      [
        "#!/bin/sh",
        'case "$*" in *thedotmack/claude-mem*)',
        `  /bin/mkdir -p ${JSON.stringify(memPath)}`,
        `  /bin/cp ${JSON.stringify(afterFile)} ${JSON.stringify(installed)} ;;`,
        "esac",
        "exit 0",
        "",
      ].join("\n"),
    );
    const backend = fakeBackend();
    writeGatewayConfig(home, backend.url);
    const result = await runAsync(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      '~ ~/.claude-mem/settings.json: CLAUDE_MEM_PROVIDER: (none) -> "openai-compatible"\n',
    );
    expect(
      readJson(join(home, ".claude-mem", "settings.json")).CLAUDE_MEM_OPENAI_COMPAT_MODEL,
    ).toBe(AFFORDABLE_MODEL);
  });
});

describe("cc-smart-dev-kit doctor: the companion plugins", () => {
  test("not added, turned off, or outside the range: one ✗ each, with what to run", () => {
    const missing = setup({ companions: false });
    missing.run(["setup"]);
    const none = missing.run(["doctor"]);
    expect(none.exitCode).toBe(1);
    expect(none.stdout).toContain(
      "✗ the thedotmack marketplace is not added, so claude-mem@thedotmack is missing and cc-smart-dev-kit does not load. Run: cc-smart-dev-kit setup\n" +
        "✗ the claude-plugins-official marketplace is not added, so frontend-design@claude-plugins-official is missing and cc-smart-dev-kit does not load. Run: cc-smart-dev-kit setup\n",
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
        "✗ frontend-design@claude-plugins-official is turned off, and cc-smart-dev-kit does not load without it. Run: claude plugin enable frontend-design@claude-plugins-official\n",
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

  test("a version that is a commit id is unknown, not older; setup says it once", () => {
    const { home, configDir, run } = setup();
    const installed = join(configDir, "plugins", "installed_plugins.json");
    const plugins = readJson(installed);
    plugins.plugins["claude-mem@thedotmack"][0].version = "8713c5b11005";
    writeFileSync(installed, JSON.stringify(plugins));
    const unknown =
      "claude-mem@thedotmack 8713c5b11005: its version is unknown (not a version number), so cc-smart-dev-kit cannot check it against >=13.29.0. Run: claude plugin update claude-mem@thedotmack";
    expect(run(["doctor"]).stdout).toContain(`✗ ${unknown}\n`);
    // With the gateway there, claude-mem's own check would say it again: it does not.
    writeGatewayConfig(home, "http://127.0.0.1:9");
    const result = run(["setup"]);
    expect(result.stdout).toContain(`! ${unknown}\n`);
    expect(result.stdout).not.toContain("older");
    expect(result.stdout).not.toContain("claude-mem settings left alone");
  });

  test("claude-mem older than 13.35.0: a warning (its vector search), never a failure", () => {
    const { configDir, run } = setup();
    run(["setup"]);
    const installed = join(configDir, "plugins", "installed_plugins.json");
    const plugins = readJson(installed);
    plugins.plugins["claude-mem@thedotmack"][0].version = "13.34.2";
    writeFileSync(installed, JSON.stringify(plugins));
    const result = run(["doctor"]);
    expect(result.stdout).toContain("✓ claude-mem@thedotmack 13.34.2 is installed and on\n");
    expect(result.stdout).toContain(
      "\n! claude-mem@thedotmack 13.34.2 is older than 13.35.0: on a fresh install its vector search may not start (pydantic 2.14 broke chroma-mcp; 13.35.0 pins pydantic below it). Run: claude plugin update claude-mem@thedotmack\n",
    );
    expect(result.exitCode).toBe(0);
  });
});

/** A git project with a `.claude/cc-smart-dev-kit.json`. */
function project(config: unknown): string {
  const dir = tempDir("project");
  git(dir, "init", "-q");
  mkdirSync(join(dir, ".claude"));
  writeFileSync(join(dir, ".claude", "cc-smart-dev-kit.json"), JSON.stringify(config));
  return dir;
}

/** The real git, with no config of the machine's. */
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };

describe("cc-smart-dev-kit setup: the auto-mode block", () => {
  const RULE = "In my-app: never touch the production database.";

  test("no terminal, also with --yes: the entries are shown, left out, and not written", () => {
    const repo = project({ autoMode: [RULE] });
    const { settingsFile, run } = setup({ fakeGit: false });
    for (const args of [["setup"], ["setup", "--yes"]]) {
      const result = run(args, GIT_ENV, repo);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toStartWith(
        [
          `Auto mode: trust rules from ${repo}/.claude/cc-smart-dev-kit.json ("autoMode"), for autoMode.environment in ~/.claude/settings.json:`,
          '  + "$defaults"',
          `  + ${JSON.stringify(RULE)}`,
          "",
        ].join("\n"),
      );
      expect(result.stdout).toContain(
        "! auto-mode entries left out: they are trust rules, so setup asks first, on a terminal. Run cc-smart-dev-kit setup in a terminal.\n",
      );
      expect(readJson(settingsFile).autoMode).toBeUndefined();
    }
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

  test("an invalid or too-new cc-smart-dev-kit.json leaves only the auto-mode entries out: the rest of setup is done", () => {
    const cases: Array<[unknown, (file: string) => string]> = [
      [{ autoMode: "not a list" }, (file) => `Invalid ${file}: autoMode:`],
      [
        { requires: ">=999.0.0" },
        (file) => `${file}: this project needs cc-smart-dev-kit >=999.0.0; you have ${VERSION};`,
      ],
    ];
    for (const [config, reason] of cases) {
      const repo = project(config);
      const { launcher, run } = setup({ fakeGit: false });
      const result = run(["setup"], GIT_ENV, repo);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("+ ~/.local/bin/cc-smart-dev-kit: launcher created\n");
      expect(result.stdout).toContain(
        `! auto-mode entries left out: ${reason(`${repo}/.claude/cc-smart-dev-kit.json`)}`,
      );
      expect(existsSync(launcher)).toBe(true);
    }
  });

  test("git older than 2.31, or a worktree whose main checkout is gone: a note, and the rest of setup", () => {
    const repo = project({ autoMode: [RULE] });
    git(repo, "commit", "--allow-empty", "-q", "-m", "first");
    const gone = join(tempDir("gone"), "main");
    const realGit = Bun.which("git") ?? "git";
    const cases: Array<[string, string]> = [
      [
        '  --version) echo "git version 2.20.1" ;;\n  rev-parse) echo "unknown option" >&2; exit 129 ;;',
        "! auto-mode entries left out: git 2.31 or newer is needed; you have git 2.20.1. Update git.\n",
      ],
      [
        `  worktree) printf 'worktree %s\\nHEAD 0000\\n\\n' ${JSON.stringify(gone)} ;;`,
        `is missing: ${gone} was moved or deleted.`,
      ],
    ];
    for (const [index, [answers, note]] of cases.entries()) {
      const { fakeBin, launcher, run } = setup({ fakeGit: false });
      rmSync(join(fakeBin, "git"));
      writeFileSync(
        join(fakeBin, "git"),
        `#!/bin/sh\ncase "$1" in\n${answers}\n  *) exec ${JSON.stringify(realGit)} "$@" ;;\nesac\n`,
      );
      chmodSync(join(fakeBin, "git"), 0o755);
      // A worktree: the main checkout is asked of `git worktree list`.
      const worktree = join(tempDir("wt"), "feature");
      git(repo, "worktree", "add", "-q", "-b", `feature-${index}`, worktree);
      const result = run(["setup"], GIT_ENV, worktree);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(note);
      expect(existsSync(launcher)).toBe(true);
    }
  });

  test("outside git, setup needs no git at all", () => {
    const { fakeBin, launcher, run } = setup();
    rmSync(join(fakeBin, "git"));
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("auto-mode");
    expect(existsSync(launcher)).toBe(true);
  });
});

const servers: { stop(force?: boolean): void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

/** A made-up backend key: it must never show in any output. */
const PLANTED_KEY = "sk-planted-SECRET-0123456789abcdef";
const AFFORDABLE_MODEL = "ollama-cloud/deepseek-v4.1-flash";

/**
 * A fake OpenAI-style backend: `POST /v1/chat/completions` answers one token; any other
 * path is a 404. With `status`, every request gets that status and `body`.
 */
function fakeBackend(status = 200, body: unknown = { error: { message: "no" } }) {
  const seen: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req): Promise<Response> {
      const path = new URL(req.url).pathname;
      seen.push(`${req.method} ${path} ${req.headers.get("authorization")} ${await req.text()}`);
      if (status !== 200) return Response.json(body, { status });
      if (req.method !== "POST" || path !== "/v1/chat/completions") {
        return new Response("404 page not found", { status: 404 });
      }
      return Response.json({ choices: [{ message: { role: "assistant", content: "OK" } }] });
    },
  });
  servers.push(server);
  return { url: `http://127.0.0.1:${server.port}`, seen };
}

/** The one request setup sends to check the backend, as the fake backend logs it. */
const CHAT_CHECK = `POST /v1/chat/completions Bearer ${PLANTED_KEY} ${JSON.stringify({
  model: AFFORDABLE_MODEL,
  messages: [{ role: "user", content: "Say OK." }],
  max_tokens: 1,
})}`;

/** gateway.json with the omniroute backend at `url`, as `gateway setup` makes it. */
function writeGatewayConfig(home: string, url: string) {
  const file = join(home, ".config", "cc-smart-dev-kit", "gateway.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      backends: { omniroute: { apiKey: PLANTED_KEY, baseUrl: url } },
      slots: {
        "cc-smart-dev-kit-scout": [`omniroute:${AFFORDABLE_MODEL}`, "claude-sonnet-5-5"],
        "cc-smart-dev-kit-worker": [`omniroute:${AFFORDABLE_MODEL}`, "claude-sonnet-5-5"],
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

describe("cc-smart-dev-kit setup: claude-mem on the gateway's affordable model", () => {
  test("claude-mem's defaults become the affordable model, with Claude Haiku as the fallback; the key never shows; restore takes them out", async () => {
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
        `~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_MODEL: "" -> "${AFFORDABLE_MODEL}"`,
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "" -> "••••cdef"',
        '~ ~/.claude-mem/settings.json: CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "" -> "claude-haiku-4-5-20251001"',
        "",
      ].join("\n"),
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain(PLANTED_KEY);
    // The key was checked against the backend once, before anything was written.
    expect(backend.seen).toEqual([CHAT_CHECK]);
    expect(readJson(file)).toEqual({
      ...SEEDED,
      CLAUDE_MEM_PROVIDER: "openai-compatible",
      CLAUDE_MEM_OPENAI_COMPAT_PRESET: "custom",
      CLAUDE_MEM_OPENAI_COMPAT_API_KEY: PLANTED_KEY,
      CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: `${backend.url}/v1`,
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: AFFORDABLE_MODEL,
      CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "claude-haiku-4-5-20251001",
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);

    // A second run: nothing to change, and no need to ask the backend again.
    expect(run(["setup"]).stdout).toBe(
      `Nothing to change. Setup is up to date.\n${TAVILY_SKIPPED}\n`,
    );
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
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: AFFORDABLE_MODEL,
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

  test("claude-mem older than 13.29.0: one note (the range check's), and nothing written", () => {
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
      "! claude-mem@thedotmack 13.28.0 is outside >=13.29.0, and cc-smart-dev-kit does not load with it. Run: claude plugin update claude-mem@thedotmack\n",
    );
    expect(result.stdout.match(/13\.28\.0/g)).toHaveLength(1);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("the backend has no chat endpoint (404), or does not serve the model: said so; the key never shows", async () => {
    const cases: Array<[number, unknown, string]> = [
      [
        404,
        "404 page not found",
        "! claude-mem settings left alone: omniroute has no OpenAI chat endpoint at URL/v1/chat/completions (HTTP 404)\n",
      ],
      [
        404,
        { error: { code: "model_not_found", message: "The model does not exist" } },
        `! claude-mem settings left alone: omniroute does not serve the model ${AFFORDABLE_MODEL} (HTTP 404)\n`,
      ],
      [
        500,
        { error: { message: `upstream rejected ${PLANTED_KEY}` } },
        `! claude-mem settings left alone: omniroute answered HTTP 500 to a one-token chat request for ${AFFORDABLE_MODEL} at URL/v1/chat/completions\n`,
      ],
    ];
    for (const [status, body, note] of cases) {
      const { home, runAsync } = setup();
      const backend = fakeBackend(status, body);
      writeGatewayConfig(home, backend.url);
      const file = writeClaudeMem(home, SEEDED);
      const before = readFileSync(file, "utf8");
      const result = await runAsync(["setup"]);
      expect(result.stdout).toContain(note.replace("URL", backend.url));
      expect(result.stdout).not.toContain("refused its key");
      expect(`${result.stdout}${result.stderr}`).not.toContain(PLANTED_KEY);
      expect(readFileSync(file, "utf8")).toBe(before);
    }
  });

  test("--dry-run reaches no network: it says which backend a real run checks", () => {
    const { home, run } = setup();
    const backend = fakeBackend();
    writeGatewayConfig(home, backend.url);
    writeClaudeMem(home, SEEDED);
    const result = run(["setup", "--dry-run"]);
    expect(result.stdout).toContain(
      "  claude-mem: would check omniroute (one chat request) before writing its settings\n",
    );
    expect(result.stdout).toContain(
      '~ ~/.claude-mem/settings.json: CLAUDE_MEM_PROVIDER: "claude" -> "openai-compatible"\n',
    );
    expect(backend.seen).toEqual([]);
  });

  test("a key cc-smart-dev-kit set and the person changed since is theirs: setup leaves all seven, restore leaves theirs", async () => {
    const { home, run, runAsync } = setup();
    const backend = fakeBackend();
    writeGatewayConfig(home, backend.url);
    const file = writeClaudeMem(home, SEEDED);
    await runAsync(["setup"]);
    const settings = readJson(file);
    settings.CLAUDE_MEM_OPENAI_COMPAT_MODEL = "my-own-model";
    writeFileSync(file, JSON.stringify(settings, null, 2));
    const before = readFileSync(file, "utf8");
    const result = run(["setup"]);
    expect(result.stdout).toContain(
      '  claude-mem settings left alone: CLAUDE_MEM_OPENAI_COMPAT_MODEL is "my-own-model" in ~/.claude-mem/settings.json (your choice)\n',
    );
    expect(readFileSync(file, "utf8")).toBe(before);
    run(["restore"]);
    expect(readJson(file)).toEqual({
      CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: "my-own-model",
      CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "claude",
      CLAUDE_MEM_CONTEXT_OBSERVATIONS: "50",
    });
  });

  test("the gateway's backend key changed: cc-smart-dev-kit updates the key it set, after the check", async () => {
    const { home, runAsync } = setup();
    const backend = fakeBackend();
    writeGatewayConfig(home, backend.url);
    const file = writeClaudeMem(home, SEEDED);
    await runAsync(["setup"]);
    const gateway = join(home, ".config", "cc-smart-dev-kit", "gateway.json");
    const config = readJson(gateway);
    config.backends.omniroute.apiKey = "sk-rotated-SECRET-9999999999999999";
    writeFileSync(gateway, JSON.stringify(config));
    const result = await runAsync(["setup"]);
    expect(result.stdout).toContain(
      '~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "••••cdef" -> "••••9999"\n',
    );
    expect(readJson(file).CLAUDE_MEM_OPENAI_COMPAT_API_KEY).toBe(
      "sk-rotated-SECRET-9999999999999999",
    );
  });

  test("cc-smart-dev-kit's keys are there, but the gateway has no affordable model any more: a note that says how to fix it", async () => {
    const { home, run, runAsync } = setup();
    writeGatewayConfig(home, fakeBackend().url);
    writeClaudeMem(home, SEEDED);
    await runAsync(["setup"]);
    rmSync(join(home, ".config", "cc-smart-dev-kit", "gateway.json"));
    expect(run(["setup"]).stdout).toBe(
      [
        "Nothing to change. Setup is up to date.",
        "! claude-mem still uses the backend cc-smart-dev-kit set for it, but the gateway is not set up. Run cc-smart-dev-kit setup again once the gateway has an affordable model, or cc-smart-dev-kit restore to put claude-mem back on its own defaults.",
        TAVILY_SKIPPED,
        "",
      ].join("\n"),
    );
  });

  test("an existing settings file readable by others: the write with the key leaves it at mode 600", async () => {
    const { home, runAsync } = setup();
    writeGatewayConfig(home, fakeBackend().url);
    const file = writeClaudeMem(home, SEEDED);
    chmodSync(file, 0o644);
    await runAsync(["setup"]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("a key pool of the person's (CLAUDE_MEM_OPENAI_COMPAT_API_KEYS): left alone, never printed", () => {
    const { home, run } = setup();
    const backend = fakeBackend();
    writeGatewayConfig(home, backend.url);
    const file = writeClaudeMem(home, {
      ...SEEDED,
      CLAUDE_MEM_OPENAI_COMPAT_API_KEYS: "sk-pool-one-000000,sk-pool-two-000000",
    });
    const before = readFileSync(file, "utf8");
    const result = run(["setup"]);
    expect(result.stdout).toContain(
      "  claude-mem settings left alone: CLAUDE_MEM_OPENAI_COMPAT_API_KEYS holds your own keys in ~/.claude-mem/settings.json (your choice)\n",
    );
    expect(result.stdout).not.toContain("sk-pool");
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(backend.seen).toEqual([]);
  });

  test("a file with only claude-mem's old nested env: left alone, with a note (claude-mem rewrites it flat itself)", () => {
    const { home, run } = setup();
    writeGatewayConfig(home, fakeBackend().url);
    const file = writeClaudeMem(home, { env: SEEDED });
    const before = readFileSync(file, "utf8");
    const result = run(["setup"]);
    expect(result.stdout).toContain(
      "! claude-mem settings left alone: ~/.claude-mem/settings.json is in claude-mem's old nested form, which claude-mem rewrites when it next starts. Start a Claude Code session, then run cc-smart-dev-kit setup again.\n",
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

describe("cc-smart-dev-kit setup: options", () => {
  test("--warp and --remove-warp together, a --project with no folder, or one that is not there: exit 2", () => {
    const { run } = setup();
    expect(run(["setup", "--warp", "--remove-warp"]).exitCode).toBe(2);
    expect(run(["setup", "--project"]).exitCode).toBe(2);
    expect(run(["setup", "--project", "/no/such/folder"]).exitCode).toBe(2);
  });
});

describe("cc-smart-dev-kit version and help", () => {
  test("version prints the plugin version", () => {
    expect(setup().run(["version"]).stdout).toBe(`cc-smart-dev-kit ${VERSION}\n`);
  });

  test("an unknown command prints help and exits 2", () => {
    const result = setup().run(["nope"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown command: nope");
  });
});

describe("cc-smart-dev-kit setup --statusline, statusline and usage", () => {
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
    expect(line.command).toEndWith("/.local/bin/cc-smart-dev-kit statusline");
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
            "cc-smart-dev-kit": {
              ...settings.extraKnownMarketplaces["cc-smart-dev-kit"],
              autoUpdate: false,
            },
          },
        }),
      );
      await expect(runSetup(paths, setupOptions(home, say(true)))).rejects.toThrow(
        "set by someone else",
      );
      expect(asked).toEqual([]);
      writeFileSync(settingsFile, JSON.stringify(settings));
      // A "no": not set, and remembered. Exit 1: this world has no `claude` on PATH, so the
      // MCP servers cannot be registered (that part is skipped and named).
      expect(await runSetup(paths, setupOptions(home, say(false)))).toBe(1);
      expect(asked).toHaveLength(1);
      expect(readJson(settingsFile)).not.toHaveProperty("statusLine");
      expect(readFileSync(join(stateDir, "statusline-declined"), "utf8")).toBe("no\n");
      // Not asked again.
      expect(await runSetup(paths, setupOptions(home, say(true)))).toBe(1);
      expect(asked).toHaveLength(1);
      expect(readJson(settingsFile)).not.toHaveProperty("statusLine");
      // `--statusline` sets it all the same.
      expect(await runSetup(paths, setupOptions(home, say(false), { statusline: true }))).toBe(1);
      expect(asked).toHaveLength(1);
      expect(readJson(settingsFile).statusLine.command).toEndWith(
        "/.local/bin/cc-smart-dev-kit statusline",
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

  test("a status line setup set and the person changed since is theirs: setup keeps it, restore leaves it", () => {
    const { settingsFile, run } = setup();
    expect(run(["setup", "--statusline"]).exitCode).toBe(0);
    const mine = { command: "my-line", type: "command" };
    writeFileSync(settingsFile, JSON.stringify({ ...readJson(settingsFile), statusLine: mine }));
    // Plain setup does not set the status line: the person's stays.
    expect(run(["setup"]).exitCode).toBe(0);
    expect(readJson(settingsFile).statusLine).toEqual(mine);
    // --statusline stops at the changed key, before anything is written.
    const again = run(["setup", "--statusline"]);
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain("statusLine");
    expect(readJson(settingsFile).statusLine).toEqual(mine);
    // restore takes out only what still holds setup's value.
    expect(run(["restore", "--yes"]).exitCode).toBe(0);
    expect(readJson(settingsFile).statusLine).toEqual(mine);
  });

  test("statusline reads Claude Code's JSON on stdin and the router's state file", () => {
    const { home, configDir } = setup();
    const guard = subprocessGuard();
    const now = Math.floor(Date.now() / 1000);
    mkdirSync(join(home, ".local", "state", "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(
      join(home, ".local", "state", "cc-smart-dev-kit", "gateway-state.json"),
      JSON.stringify({
        fallbacks: {
          "cc-smart-dev-kit-judge": {
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
    const result = Bun.spawnSync([process.execPath, ...guard.args, CLI, "statusline"], {
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

describe("cc-smart-dev-kit setup: the MCP servers", () => {
  test("setup registers them at user scope, doctor checks them, restore takes them back", () => {
    const { configDir, home, run } = setup();
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("+ MCP server playwright registered for your user\n");
    // Claude Code's own config holds them, and the launcher is the browser server's command.
    const userConfig = readJson(join(configDir, ".claude.json"));
    expect(Object.keys(userConfig.mcpServers).sort()).toEqual([
      "playwright",
      "sequential-thinking",
      "serena",
    ]);
    expect(userConfig.mcpServers.playwright).toEqual({
      args: ["browser", "mcp"],
      command: join(home, ".local", "bin", "cc-smart-dev-kit"),
    });
    expect(userConfig.mcpServers.serena.args).toContain("--project-from-cwd");
    // Serena's context is installed beside the plugin's data, and is a managed file.
    expect(
      existsSync(join(home, ".local/share/cc-smart-dev-kit/serena/contexts/worktree.yml")),
    ).toBe(true);

    // doctor: each one is registered and starts (the fake `claude mcp get` says Connected).
    const checked = run(["doctor"]);
    expect(checked.stdout).toContain('✓ MCP server "playwright": Connected\n');
    expect(checked.stdout).toContain('✓ MCP server "serena": Connected\n');
    expect(checked.stdout).toContain('✓ MCP server "sequential-thinking": Connected\n');

    // restore: removed from Claude Code's config, and no record left.
    const restored = run(["restore"]);
    expect(restored.exitCode).toBe(0);
    expect(restored.stdout).toContain("- MCP server playwright removed from your user config\n");
    expect(readJson(join(configDir, ".claude.json")).mcpServers).toEqual({});
    expect(existsSync(join(configDir, "cc-smart-dev-kit", "mcp-servers.json"))).toBe(false);
    expect(
      existsSync(join(home, ".local/share/cc-smart-dev-kit/serena/contexts/worktree.yml")),
    ).toBe(false);
  });

  test("a Tavily key in a 0600 file: an owned secret in the settings, never printed, mode 600", () => {
    const { configDir, home, run } = setup();
    const keyFile = join(configDir, "cc-smart-dev-kit", "tavily.key");
    mkdirSync(join(configDir, "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(keyFile, "tvly-file-secret\n", { mode: 0o600 });
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    // Registered with the placeholder Claude Code fills in at connect time, never the key.
    const userConfig = readJson(join(configDir, ".claude.json"));
    expect(userConfig.mcpServers["tavily-websearch"]).toEqual({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's placeholder.
      headers: { Authorization: "Bearer ${TAVILY_API_KEY}" },
      timeout: 300_000,
      type: "http",
      url: "https://mcp.tavily.com/mcp/",
    });
    // The key itself went into the settings, an owned secret left at mode 600.
    const settings = readJson(join(home, ".claude", "settings.json"));
    expect(settings.env.TAVILY_API_KEY).toBe("tvly-file-secret");
    expect(statSync(join(home, ".claude", "settings.json")).mode & 0o777).toBe(0o600);
    expect(`${result.stdout}${result.stderr}`).not.toContain("tvly-file-secret");
    expect(result.stdout).toContain("(a secret)");
    // doctor sees the key and checks the server; it never prints the key either.
    const checked = run(["doctor"]);
    expect(checked.stdout).toContain('✓ MCP server "tavily-websearch": Connected\n');
    expect(checked.stdout).not.toContain("tvly-file-secret");
    // restore removes it again, and never prints it either.
    const restored = run(["restore"]);
    expect(restored.exitCode).toBe(0);
    expect(`${restored.stdout}${restored.stderr}`).not.toContain("tvly-file-secret");
    // The line names the key's PATH, never its value.
    expect(restored.stdout).toContain("env.TAVILY_API_KEY; everything else kept");
    expect(readJson(join(home, ".claude", "settings.json")).env?.TAVILY_API_KEY).toBeUndefined();
  });

  test("a Tavily key the environment already has: nothing is written for it", () => {
    const { configDir, home, run } = setup();
    const result = run(["setup"], { TAVILY_API_KEY: "tvly-from-environment" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("+ MCP server tavily-websearch registered for your user\n");
    expect(readJson(join(home, ".claude", "settings.json")).env?.TAVILY_API_KEY).toBeUndefined();
    expect(result.stdout).not.toContain("tvly-from-environment");
    // The registration still carries only the placeholder.
    expect(
      readJson(join(configDir, ".claude.json")).mcpServers["tavily-websearch"].headers,
    ).toEqual({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's placeholder.
      Authorization: "Bearer ${TAVILY_API_KEY}",
    });
  });

  test("the key moves to the environment: the copy cc-smart-dev-kit wrote is removed", () => {
    const { configDir, home, run } = setup();
    const keyFile = join(configDir, "cc-smart-dev-kit", "tavily.key");
    mkdirSync(join(configDir, "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(keyFile, "tvly-file-secret\n", { mode: 0o600 });
    expect(run(["setup"]).exitCode).toBe(0);
    expect(readJson(join(home, ".claude", "settings.json")).env.TAVILY_API_KEY).toBe(
      "tvly-file-secret",
    );

    // The person sets the key in their environment instead: the stale copy in the settings
    // goes (its value is never printed), and the server stays registered.
    const again = run(["setup"], { TAVILY_API_KEY: "tvly-from-environment" });
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain(
      "~ ~/.claude/settings.json: env.TAVILY_API_KEY: (a secret) -> (none)",
    );
    expect(`${again.stdout}${again.stderr}`).not.toContain("tvly-file-secret");
    expect(readJson(join(home, ".claude", "settings.json")).env?.TAVILY_API_KEY).toBeUndefined();
    expect(readJson(join(configDir, ".claude.json")).mcpServers["tavily-websearch"]).toBeDefined();
  });

  test("no key at all any more: the recorded Tavily server is unregistered too", () => {
    const { configDir, home, run } = setup();
    const keyFile = join(configDir, "cc-smart-dev-kit", "tavily.key");
    mkdirSync(join(configDir, "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(keyFile, "tvly-file-secret\n", { mode: 0o600 });
    expect(run(["setup"]).exitCode).toBe(0);
    expect(readJson(join(configDir, ".claude.json")).mcpServers["tavily-websearch"]).toBeDefined();

    // The key file goes, and the environment has none: the server goes back, and so does the
    // copy of the key in the settings.
    rmSync(keyFile);
    const again = run(["setup"]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain("- MCP server tavily-websearch removed from your user config\n");
    expect(again.stdout).toContain(TAVILY_SKIPPED);
    expect(
      readJson(join(configDir, ".claude.json")).mcpServers["tavily-websearch"],
    ).toBeUndefined();
    expect(readJson(join(home, ".claude", "settings.json")).env?.TAVILY_API_KEY).toBeUndefined();
    // Its record went with it: restore has nothing of it left to take back.
    expect(
      readJson(join(configDir, "cc-smart-dev-kit", "mcp-servers.json")).servers["tavily-websearch"],
    ).toBeUndefined();
  });

  test("a key file others can read is refused, naming the file and never its content", () => {
    const { configDir, run } = setup();
    const keyFile = join(configDir, "cc-smart-dev-kit", "tavily.key");
    mkdirSync(join(configDir, "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(keyFile, "tvly-exposed-secret\n", { mode: 0o644 });
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `! tavily-websearch: skipped — ${keyFile} is readable by others (mode 644): run \`chmod 600 ${keyFile}\`, then setup again`,
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain("tvly-exposed-secret");
    // And doctor reports it as information, never a failure.
    const checked = run(["doctor"]);
    expect(checked.exitCode).toBe(0);
    expect(checked.stdout).toContain("· the Tavily MCP server is skipped: ");
    expect(checked.stdout).not.toContain("tvly-exposed-secret");
  });

  test("a server of the person's own under one of our names is never taken over", () => {
    const { configDir, run, claudeCalls } = setup();
    writeFileSync(
      join(configDir, ".claude.json"),
      JSON.stringify({ mcpServers: { playwright: { args: [], command: "/opt/theirs" } } }),
    );
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "! playwright is registered already, and not by cc-smart-dev-kit: left alone",
    );
    expect(readJson(join(configDir, ".claude.json")).mcpServers.playwright).toEqual({
      args: [],
      command: "/opt/theirs",
    });
    // Claude Code was never asked to touch it.
    expect(claudeCalls()).not.toContain("mcp remove playwright");
  });

  test("--dry-run prints the registrations and runs none", () => {
    const { configDir, run } = setup();
    const result = run(["setup", "--dry-run"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('$ claude mcp add-json --scope user playwright {"command":"');
    expect(existsSync(join(configDir, ".claude.json"))).toBe(false);
  });
});
