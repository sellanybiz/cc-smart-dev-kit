import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
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
import { COMMAND, MARKETPLACE_SOURCE, VERSION } from "../build-info";
import { USAGE as GATEWAY_USAGE } from "../gateway/commands";
import { localDay } from "../gateway/safety-checks";
import { type Machine, TEST_HOST_VAR } from "../machine/machine";
import { recordMcpServer } from "../mcp/records";
import { serenaLeftoverPaths } from "../mcp/retired";
import { MCP_VERSIONS } from "../mcp/versions";
import { TEST_PORTAL_VAR } from "../portal/health";
import { versionStampFile } from "../setup/instructions";
import { installLauncher } from "../setup/launcher";
import { installLauncherCmd } from "../setup/launcher-cmd";
import { applyManagedJson } from "../setup/managed-json";
import { restore } from "../setup/restore";
import { retryWatchdogDeclinedFile } from "../setup/retry-watchdog";
import { USER_NOTIFY_HOOK_NAME } from "../setup/user-notify-hook";
import { listBackups, writeManagedFile } from "../setup/write";
import { FAKE_CLAUDE_MCP_JS } from "../testing/fake-claude-mcp";
import { subprocessGuard } from "../testing/port-guard";
import { git, tempDir } from "../testing/temp";
import { PROCESS_TEST_TIMEOUT_MS } from "../testing/timeouts";
import { workflowDefaults } from "../workflow/schema";
import { ccSmartDevKitImports, type DoctorReport, runDoctor } from "./doctor";
import { COMMAND_HELP, HELP_COMMAND } from "./help";
import { cliPaths } from "./paths";
import { type SetupOptions as RunSetupOptions, runSetup } from "./setup";
import { createOut, textSink } from "./ui/out";
import { detectTerminal } from "./ui/terminal";

// This file starts the CLI as a real process: its own speed limit (src/testing/timeouts.ts).
setDefaultTimeout(PROCESS_TEST_TIMEOUT_MS);

const CLI = join(import.meta.dir, "..", "entries", "cli.ts");

interface SetupOptions {
  marketplace?: boolean;
  gitOk?: boolean;
  /**
   * What the fake git prints on stderr as it fails, line by line. Default: the URL-with-a-token
   * 403 line — a failure that names neither of the two causes doctor can point at.
   */
  gitStderr?: string;
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
  /**
   * A ready browser for this world (default: true): the Chrome profile `claude-code` with the
   * Playwright extension in it, the file-URL switch on, a saved token, and the `playwright`
   * registration as setup leaves it. false models the machine that has not done the browser's
   * steps yet, where the browser's own lines are ✗ and `doctor` exits 1 — the state
   * `src/browser/`'s own tests cover line by line.
   */
  browser?: boolean;
  /**
   * System paths that exist on the test's machine (`host.exists`). Empty by default: no Chrome,
   * no Warp app — never whatever the machine running the test happens to have.
   */
  existing?: string[];
  /** The fake git first on PATH. Default: true. false: the real git (a real project). */
  fakeGit?: boolean;
}

/** The Chrome this world claims is installed, when `browser: true` asks for a ready browser. */
const CHROME_ON_PATH = "/usr/bin/google-chrome";

/** Where Chrome keeps its profiles under a home folder, on Linux. */
function browserChromeDir(home: string): string {
  return join(home, ".config", "google-chrome");
}

/** The Playwright extension's id, for the profile this world writes. */
const PLAYWRIGHT_EXTENSION_ID = "mmlmfjhmonkocbjadbfplnigmagldckm";

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
  // It logs each call, has no core.sshCommand, and fails ls-remote when gitOk is false —
  // with `gitStderr` line by line, so a multi-line failure arrives as several lines.
  const fakeBin = join(home, "fake-bin");
  const gitLog = join(home, "git-calls.log");
  mkdirSync(fakeBin);
  if (options.fakeGit !== false) {
    const stderr =
      options.gitStderr ?? "fatal: unable to access 'https://bot:tok@git.example.com/r.git/': 403";
    writeFileSync(
      join(fakeBin, "git"),
      [
        "#!/bin/sh",
        `echo "$* | prompt=$GIT_TERMINAL_PROMPT | ssh=$GIT_SSH_COMMAND" >> ${JSON.stringify(gitLog)}`,
        '[ "$1" = config ] && exit 1',
        options.gitOk === false
          ? `printf '%s\\n' ${stderr
              .split("\n")
              .map((line) => JSON.stringify(line))
              .join(" ")} >&2; exit 128`
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

  // bun, alone in a folder of the test's own: the fake `claude` runs it for its `mcp`
  // helper. Never the host's bun folder: `setup` registers the `bunx` it finds beside it
  // (`servers.ts`), and a runner installs bun with its `bunx` in the same folder
  // (`~/.bun/bin`), so the output would depend on the machine. A test that wants `bunx`
  // writes one into this folder itself.
  const bunBin = join(home, "bun-bin");
  mkdirSync(bunBin);
  symlinkSync(process.execPath, join(bunBin, "bun"));

  // The CLI runs as its own process: it never reads the host. PATH holds the fakes, the
  // launcher's folder and bun's, nothing else; the host's facts are given (a Linux with no
  // os-release, so no package manager cc-smart-dev-kit knows, and no Warp app).
  // `browser: true`: the browser as it is once its steps are done. The Chrome EXECUTABLE is a
  // path this world claims exists (`host.exists` is the whole truth there), the profile and the
  // token are real files under the temp home, and the token has the extension's own shape.
  const paths_ = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: configDir });
  const browserFiles: string[] = [];
  if (options.browser !== false) {
    const chrome = join(browserChromeDir(home), "claude-code");
    mkdirSync(join(chrome, "Extensions", PLAYWRIGHT_EXTENSION_ID, "0.4.0"), { recursive: true });
    writeFileSync(
      join(chrome, "Preferences"),
      JSON.stringify({
        extensions: { settings: { [PLAYWRIGHT_EXTENSION_ID]: { newAllowFileAccess: true } } },
      }),
    );
    mkdirSync(dirname(paths_.browserTokenFile), { recursive: true, mode: 0o700 });
    writeFileSync(paths_.browserTokenFile, `${"A".repeat(40)}_-b\n`, { mode: 0o600 });
    browserFiles.push(CHROME_ON_PATH, chrome, paths_.browserTokenFile);
  }
  const env: Record<string, string> = {
    HOME: home,
    CLAUDE_CONFIG_DIR: configDir,
    PATH: `${fakeBin}:${join(home, ".local", "bin")}:${bunBin}`,
    // The portal's own line, without a port: no test may read a real portal on the machine.
    [TEST_PORTAL_VAR]: "free",
    [TEST_HOST_VAR]: JSON.stringify({
      existing: [...(options.existing ?? []), ...browserFiles],
      platform: "linux",
      arch: "x64",
      osRelease: null,
      macApp: join(home, "no-such-Warp.app"),
    }),
  };
  // The CLI runs in the temp HOME, never in this repo: doctor reads the CLAUDE.md files of
  // the current folder and the folders above it.
  const run = (
    args: string[],
    extraEnv: Record<string, string> = {},
    cwd = home,
    input?: string,
  ) => {
    // The live-router guard runs in the CLI too: no test may reach port 20100.
    const guard = subprocessGuard();
    const result = Bun.spawnSync([process.execPath, ...guard.args, CLI, ...args], {
      // Outside any project by default: doctor also checks the project of the folder it
      // runs in, and a test that wants one passes its own `cwd`.
      cwd,
      env: { ...env, ...extraEnv, ...guard.env },
      // `input`: what the command reads on stdin (a key for `--tavily-key-stdin`); the
      // terminal is inherited otherwise.
      ...(input === undefined ? {} : { stdin: new Blob([input]) }),
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
    /** The folder on PATH that holds bun, and nothing else: a test may add its own `bunx`. */
    bunBin,
    run,
    runAsync,
    gitCalls,
    claudeCalls,
    pluginCalls,
  };
}

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

/**
 * For setup or doctor run in this process: a Linux with no package manager cc-smart-dev-kit knows,
 * no Warp app and no command on PATH, so nothing of the host this test runs on is read.
 */
function noHostMachine(home: string, confirm: Machine["confirm"]): Machine {
  return {
    run: () => ({ exitCode: 1, output: "" }),
    runOnTerminal: () => 1,
    spawnDetached: () => undefined,
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
    statusline: false,
    retryWatchdog: null,
    // No environment of its own: a test that wants a key sets one through `extra`.
    env: {},
    tavilyKeyStdin: null,
    ...extra,
  };
}

/**
 * What a first setup prints for the instructions, in their section: the plugin's real files,
 * then the block.
 */
const INSTRUCTIONS_CREATED = [
  "  + ~/.claude/cc-smart-dev-kit/instructions/core.md: created",
  "  + ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: created",
  "  + ~/.claude/CLAUDE.md: created, with the cc-smart-dev-kit block",
];

/**
 * The MCP servers setup registers, as it prints them in their section: the two that need no
 * key. Tavily is left out without a key (`TAVILY_SKIPPED`).
 */
const MCP_REGISTERED = [
  "  + MCP server playwright registered for your user",
  "  + MCP server sequential-thinking registered for your user",
];
/**
 * D56: setup turns Claude Code's retry watchdog on by default, as any other owned key: three
 * `~` lines and one `·` line that says what it means.
 */
const WATCHDOG_LINES = [
  '  ~ ~/.claude/settings.json: env.CLAUDE_CODE_RETRY_WATCHDOG: (none) -> "1"',
  '  ~ ~/.claude/settings.json: env.CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS: (none) -> "300000"',
  '  ~ ~/.claude/settings.json: env.CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS: (none) -> "86400000"',
];
const WATCHDOG_ON_NOTE =
  '  · retry watchdog: on, so every Claude session on this machine waits and retries at a limit instead of failing ("Retrying in …"; Esc cancels); a limit that resets more than 24 hours away ends the wait; a `claude -p` script can wait until a model answers; to turn it off: cc-smart-dev-kit setup --no-retry-watchdog';
/** The same three keys as they land in `settings.json`'s `env`. */
const WATCHDOG_ENV = {
  CLAUDE_CODE_RETRY_WATCHDOG: "1",
  CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS: "300000",
  CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS: "86400000",
};
/** setup's warning for the Tavily server on a machine with no key, in the MCP section. */
const TAVILY_SKIPPED =
  "  ! tavily-websearch: skipped — no TAVILY_API_KEY in the environment, in the settings, or in a key file: put the key there (chmod 600), or set the variable, then run setup again";
/** The MCP section of a machine where nothing else is said about the servers. */
const MCP_TAVILY_ONLY = ["! MCP servers           1 warning", TAVILY_SKIPPED];

/**
 * The `claude mcp add-json` lines a dry run prints, written by hand from `home`. These
 * temp machines have no `bunx` anywhere on PATH, so the sequential-thinking registration
 * keeps the bare name; a machine with one gets that `bunx`'s absolute path (§ MCP servers).
 */
function mcpDryRunLines(home: string): string[] {
  const launcher = join(home, ".local", "bin", "cc-smart-dev-kit");
  return [
    `  $ claude mcp add-json --scope user playwright {"command":"${launcher}","args":["browser","mcp"]}`,
    `  $ claude mcp add-json --scope user sequential-thinking {"args":["-y","@modelcontextprotocol/server-sequential-thinking@${MCP_VERSIONS.sequentialThinking}"],"command":"bunx"}`,
  ];
}

/** setup's first line on a real run, and on a dry run. */
const SETUP_HEADING = `cc-smart-dev-kit ${VERSION}: setting up this machine`;
const SETUP_DRY_HEADING = `cc-smart-dev-kit ${VERSION}: what setup would change (dry run)`;
/** The verdict's sentence when a file was written. */
const BACKUPS = "Each changed file has a backup in ~/.claude/cc-smart-dev-kit/backups/.";
/** The verdict of a run with nothing to change but the Tavily warning. */
const UP_TO_DATE = "! Nothing to change. Setup is up to date, with 1 warning to read above.";
/** The next step after a change a running Claude Code session does not see. */
const RESTART_STEP =
  "Start a new Claude Code session (and restart the ones running): a session reads its settings, instructions, plugins and MCP servers when it starts.";
/** The same step when claude-mem's settings changed too. */
const RESTART_WITH_CLAUDE_MEM = `${RESTART_STEP} claude-mem's start hook reads its new settings then too, and its worker reads them when it starts.`;

/**
 * The whole of setup's stdout, the way it prints it: the heading, a blank line, the sections,
 * a blank line, the verdict (and a dry run's last line), and the next steps after a blank line.
 * Every line of each part is written out by hand in the test.
 */
function setupStdout(
  heading: string,
  sections: readonly string[],
  verdict: readonly string[],
  next: readonly string[] = [],
): string {
  const steps = next.map((step, index) => `  ${index + 1}. ${step}`);
  return [
    heading,
    "",
    ...sections,
    "",
    ...verdict,
    ...(steps.length === 0 ? [] : ["", "Next steps:", ...steps]),
    "",
  ].join("\n");
}

/** The companions' section of a first setup: claude-mem's two start blocks off (D23), and the warning. */
const CLAUDE_MEM_OFF = [
  "! Companion plugins     2 changes, 1 warning",
  '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_WORK_STATE_ENABLED: (none) -> "false"',
  '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: (none) -> "false"',
  "  ! claude-mem's work state goes off: its to-do lists are no longer shown in a session. Read one first with claude-mem's work_state_read tool, or turn work state back on by setting CLAUDE_MEM_WORK_STATE_ENABLED to \"true\" in ~/.claude-mem/settings.json.",
];

/** A re-run with nothing to change on a machine with no Tavily key: what it prints, whole. */
const NOTHING_TO_CHANGE = setupStdout(SETUP_HEADING, MCP_TAVILY_ONLY, [UP_TO_DATE]);

/** doctor's information line for the Tavily server on a machine with no key. */
const tavilyDoctorSkipped = (home: string): string =>
  `· the Tavily MCP server is skipped: no TAVILY_API_KEY in the environment, in the settings, or in a key file: put the key there (chmod 600), or set the variable, then run setup again (key file: ${join(home, ".claude", "cc-smart-dev-kit", "tavily.key")})`;

/** doctor's lines for the MCP servers, after a setup registered them. */
const MCP_DOCTOR_OK = [
  '✓ MCP server "playwright": Connected',
  '✓ MCP server "sequential-thinking": Connected',
];

/** The user-level Notification hook setup writes for agent view, and its line. */
const NOTIFY_HOOK_ENTRY = {
  matcher: "agent_needs_input|agent_completed",
  hooks: [
    { type: "command", command: '"$HOME/.local/bin/cc-smart-dev-kit" hook notify', timeout: 10 },
  ],
};
const NOTIFY_HOOK_ADDED = `  ~ ~/.claude/settings.json: hooks.Notification: added the agent-view notification hook ("$HOME/.local/bin/cc-smart-dev-kit" hook notify)`;

/** The block setup writes into ~/.claude/CLAUDE.md. */
const BLOCK = [
  "<!-- cc-smart-dev-kit:begin -->",
  "<!-- Written by cc-smart-dev-kit setup. `cc-smart-dev-kit setup --no-instructions` takes it out. -->",
  "@~/.claude/cc-smart-dev-kit/instructions/core.md",
  "<!-- cc-smart-dev-kit:end -->",
].join("\n");

const PLUGIN_INSTRUCTIONS = join(import.meta.dir, "..", "..", "plugin", "instructions");

/** What setup prints when it stores `--no-instructions`, and when `--instructions` clears it. */
const OPT_OUT_STORED =
  "  + ~/.claude/cc-smart-dev-kit/no-instructions: setup leaves the instructions out from now on (`cc-smart-dev-kit setup --instructions` brings them back)";
const OPT_OUT_CLEARED =
  "  - ~/.claude/cc-smart-dev-kit/no-instructions: removed: setup installs the instructions again";

/** doctor's line for instructions that are in place. */
const INSTRUCTIONS_OK =
  "✓ the instructions copy ~/.claude/cc-smart-dev-kit/instructions/ is this version's, and ~/.claude/CLAUDE.md imports it";

describe("cc-smart-dev-kit setup", () => {
  test("installs the launcher and turns Claude Code's own plugin auto-update off, keeping the other settings", () => {
    const { settingsFile, launcher, run, pluginCalls } = setup();
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    // The companions are there already: no `claude plugin …` step runs.
    expect(pluginCalls()).toBe("");
    expect(result.stdout).toBe(
      setupStdout(
        SETUP_HEADING,
        [
          "✓ The command           1 change",
          "  + ~/.local/bin/cc-smart-dev-kit: launcher created",
          "✓ Claude Code settings  7 changes, 1 note",
          '  ~ ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> false',
          "  ~ ~/.claude/settings.json: remoteControlAtStartup: (none) -> true",
          ...WATCHDOG_LINES,
          // D23: work state off gives sessions Claude Code's own task tools.
          '  ~ ~/.claude/settings.json: env.CLAUDE_CODE_ENABLE_TODO_TOOLS: (none) -> "1"',
          NOTIFY_HOOK_ADDED,
          WATCHDOG_ON_NOTE,
          "✓ Instructions          3 changes",
          ...INSTRUCTIONS_CREATED,
          ...CLAUDE_MEM_OFF,
          "! MCP servers           2 changes, 1 warning",
          ...MCP_REGISTERED,
          TAVILY_SKIPPED,
        ],
        [`! Done: 15 changes, with 2 warnings to read above. ${BACKUPS}`],
        [RESTART_WITH_CLAUDE_MEM],
      ),
    );
    expect(existsSync(launcher)).toBe(true);
    expect(readJson(settingsFile)).toEqual({
      model: "opus",
      remoteControlAtStartup: true,
      hooks: { Notification: [NOTIFY_HOOK_ENTRY] },
      env: { ...WATCHDOG_ENV, CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" },
      enabledPlugins: {
        "cc-smart-dev-kit@cc-smart-dev-kit": true,
        "claude-mem@thedotmack": true,
        "frontend-design@claude-plugins-official": true,
      },
      extraKnownMarketplaces: {
        "cc-smart-dev-kit": {
          source: { source: "github", repo: "example-org/cc-smart-dev-kit" },
          autoUpdate: false,
        },
      },
    });
  });

  test("D39: an older setup's own autoUpdate true becomes false; the record follows", () => {
    const { stateDir, settingsFile, run } = setup();
    run(["setup"]);
    // What 0.6.0's setup left: the key at true, and owned.json saying it wrote true.
    const settings = readJson(settingsFile);
    settings.extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate = true;
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    const ownedFile = join(stateDir, "owned.json");
    writeFileSync(
      ownedFile,
      readFileSync(ownedFile, "utf8").replace(
        '"autoUpdate"\n      ],\n      "value": false',
        '"autoUpdate"\n      ],\n      "value": true',
      ),
    );
    // The owned.json record of the autoUpdate key, read as data (other keys have records too).
    const autoUpdateRecord = () =>
      (Object.values(readJson(ownedFile)).flat() as { path: string[]; value: unknown }[]).find(
        (record) => record.path.at(-1) === "autoUpdate",
      );
    expect(autoUpdateRecord()?.value).toBe(true);
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      setupStdout(
        SETUP_HEADING,
        [
          "✓ Claude Code settings  1 change",
          '  ~ ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: true -> false',
          ...MCP_TAVILY_ONLY,
        ],
        [`! Done: 1 change, with 1 warning to read above. ${BACKUPS}`],
        [RESTART_STEP],
      ),
    );
    expect(readJson(settingsFile).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBe(
      false,
    );
    expect(autoUpdateRecord()?.value).toBe(false);
  });

  test("the backups go into the state folder, never beside the files", () => {
    const { configDir, stateDir, settingsFile, binDir, run } = setup();
    run(["setup"]);
    // Two changes to settings.json: the auto-update key, then the notification hook.
    expect(listBackups(stateDir, settingsFile)).toHaveLength(2);
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
    expect(result.stdout).toBe(NOTHING_TO_CHANGE);
    expect(listBackups(stateDir, settingsFile)).toHaveLength(2);
  });

  test("--dry-run prints the changes and writes nothing at all: no state folder, no lock", () => {
    const { home, stateDir, settingsFile, run } = setup();
    const before = readFileSync(settingsFile, "utf8");
    const result = run(["setup", "--dry-run"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      setupStdout(
        SETUP_DRY_HEADING,
        [
          "· The command           1 to change",
          "  + ~/.local/bin/cc-smart-dev-kit: launcher created",
          "· Claude Code settings  7 to change, 1 note",
          '  ~ ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> false',
          "  ~ ~/.claude/settings.json: remoteControlAtStartup: (none) -> true",
          ...WATCHDOG_LINES,
          // D23: work state off gives sessions Claude Code's own task tools.
          '  ~ ~/.claude/settings.json: env.CLAUDE_CODE_ENABLE_TODO_TOOLS: (none) -> "1"',
          NOTIFY_HOOK_ADDED,
          WATCHDOG_ON_NOTE,
          "· Instructions          3 to change",
          ...INSTRUCTIONS_CREATED,
          "! Companion plugins     2 to change, 1 warning",
          ...CLAUDE_MEM_OFF.slice(1),
          "! MCP servers           2 to change, 1 warning",
          ...mcpDryRunLines(home),
          TAVILY_SKIPPED,
        ],
        ["· A real run makes 15 changes.", "Dry run: nothing was written or run."],
      ),
    );
    expect(readFileSync(settingsFile, "utf8")).toBe(before);
    expect(existsSync(stateDir)).toBe(false);
    expect(existsSync(join(home, ".local"))).toBe(false);
  });

  test("a key the user set (autoUpdate: true) fails before anything is written", () => {
    const { stateDir, settingsFile, launcher, run } = setup();
    const settings = readJson(settingsFile);
    settings.extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate = true;
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    const before = readFileSync(settingsFile, "utf8");
    const result = run(["setup"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate is true, set by someone else.',
    );
    expect(readFileSync(settingsFile, "utf8")).toBe(before);
    expect(existsSync(launcher)).toBe(false);
    expect(existsSync(stateDir)).toBe(false);
  });

  test("auto-update turned on by the person after setup: theirs now; setup stops, restore leaves it", () => {
    const { settingsFile, launcher, run } = setup();
    run(["setup"]);
    const settings = readJson(settingsFile);
    settings.extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate = true;
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    const result = run(["setup"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate is true: it was changed after cc-smart-dev-kit set it, so it is your choice now.',
    );
    expect(readJson(settingsFile).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBe(true);
    expect(run(["restore"]).exitCode).toBe(0);
    expect(readJson(settingsFile).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBe(true);
    expect(existsSync(launcher)).toBe(false);
  });

  test("nothing to change, with lines of information: they show in their section, and the verdict says nothing changed", () => {
    const { settingsFile, run } = setup();
    run(["setup"]);
    // The person's own auto-update key, with the value cc-smart-dev-kit wants: not cc-smart-dev-kit's.
    const ownedFile = join(dirname(settingsFile), "cc-smart-dev-kit", "owned.json");
    writeFileSync(ownedFile, "{}\n");
    const result = run(["setup"]);
    expect(result.stdout).toBe(
      setupStdout(
        SETUP_HEADING,
        [
          "· Claude Code settings  2 notes",
          '  · ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: already set by someone else; left alone',
          "  · ~/.claude/settings.json: env.CLAUDE_CODE_ENABLE_TODO_TOOLS: already set by someone else; left alone",
          ...MCP_TAVILY_ONLY,
        ],
        [UP_TO_DATE],
      ),
    );
  });

  test("UX-7: a next step when ~/.local/bin is not on PATH, with the line for this shell, and none when it is", () => {
    const { fakeBin, home, run } = setup();
    expect(run(["setup"]).stdout).not.toContain("to your PATH");
    const step = (file: string) =>
      `  1. Add ~/.local/bin to your PATH, so the cc-smart-dev-kit command works: add this line to ${file}, then open a new terminal:\n       export PATH="$HOME/.local/bin:$PATH"`;
    // The world's own PATH without the launcher's folder: the fakes and bun's own folder.
    const path = `${fakeBin}:${join(home, "bun-bin")}`;
    // Nothing else to change: the PATH step is the only one.
    expect(run(["setup"], { PATH: path }).stdout).toBe(
      `${NOTHING_TO_CHANGE}\nNext steps:\n${step("~/.profile")}\n`,
    );
    expect(run(["setup"], { PATH: path, SHELL: "/bin/bash" }).stdout).toContain(
      `\n${step("~/.bashrc")}\n`,
    );
    expect(run(["setup"], { PATH: path, SHELL: "/usr/bin/zsh" }).stdout).toContain(
      `\n${step("~/.zshrc")}\n`,
    );
    expect(run(["setup"], { PATH: path, SHELL: "/usr/local/bin/fish" }).stdout).toContain(
      "\n  1. Add ~/.local/bin to your PATH, so the cc-smart-dev-kit command works: run this once, then open a new terminal:\n       fish_add_path ~/.local/bin\n",
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
      setupStdout(
        SETUP_HEADING,
        [
          "✓ Instructions          1 change",
          "  ~ ~/.claude/cc-smart-dev-kit/instructions/core.md: updated",
          ...MCP_TAVILY_ONLY,
        ],
        [`! Done: 1 change, with 1 warning to read above. ${BACKUPS}`],
        [RESTART_STEP],
      ),
    );
  });

  test("--no-instructions on a fresh machine: no copy, no CLAUDE.md", () => {
    const { configDir, stateDir, run } = setup();
    const result = run(["setup", "--no-instructions"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      setupStdout(
        SETUP_HEADING,
        [
          "✓ The command           1 change",
          "  + ~/.local/bin/cc-smart-dev-kit: launcher created",
          "✓ Claude Code settings  7 changes, 1 note",
          '  ~ ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> false',
          "  ~ ~/.claude/settings.json: remoteControlAtStartup: (none) -> true",
          ...WATCHDOG_LINES,
          // D23: work state off gives sessions Claude Code's own task tools.
          '  ~ ~/.claude/settings.json: env.CLAUDE_CODE_ENABLE_TODO_TOOLS: (none) -> "1"',
          NOTIFY_HOOK_ADDED,
          WATCHDOG_ON_NOTE,
          "✓ Instructions          1 change",
          OPT_OUT_STORED,
          ...CLAUDE_MEM_OFF,
          "! MCP servers           2 changes, 1 warning",
          ...MCP_REGISTERED,
          TAVILY_SKIPPED,
        ],
        [`! Done: 13 changes, with 2 warnings to read above. ${BACKUPS}`],
        [RESTART_WITH_CLAUDE_MEM],
      ),
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
      "  ~ ~/.claude/CLAUDE.md: cc-smart-dev-kit block removed",
      "  - ~/.claude/cc-smart-dev-kit/instructions/core.md: removed",
      "  - ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md: removed",
    ];
    expect(dry.stdout).toBe(
      setupStdout(
        SETUP_DRY_HEADING,
        ["· Instructions          4 to change", ...expected, ...MCP_TAVILY_ONLY],
        ["· A real run makes 4 changes.", "Dry run: nothing was written or run."],
      ),
    );
    expect(readFileSync(claudeMd, "utf8")).toContain(BLOCK);

    const result = run(["setup", "--no-instructions"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      setupStdout(
        SETUP_HEADING,
        ["✓ Instructions          4 changes", ...expected, ...MCP_TAVILY_ONLY],
        [`! Done: 4 changes, with 1 warning to read above. ${BACKUPS}`],
        [RESTART_STEP],
      ),
    );
    expect(readFileSync(claudeMd, "utf8")).toBe("# My notes\n");
    expect(existsSync(join(stateDir, "instructions"))).toBe(false);
    expect(run(["setup", "--no-instructions"]).stdout).toBe(NOTHING_TO_CHANGE);
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
    expect(result.stdout).toBe(NOTHING_TO_CHANGE);
    expect(existsSync(join(configDir, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(stateDir, "instructions"))).toBe(false);
  });

  test("--instructions opts back in: the choice is cleared and they are installed", () => {
    const { stateDir, run } = setup();
    run(["setup", "--no-instructions"]);
    const dry = run(["setup", "--instructions", "--dry-run"]);
    expect(dry.stdout).toBe(
      setupStdout(
        SETUP_DRY_HEADING,
        [
          "· Instructions          4 to change",
          OPT_OUT_CLEARED,
          ...INSTRUCTIONS_CREATED,
          ...MCP_TAVILY_ONLY,
        ],
        ["· A real run makes 4 changes.", "Dry run: nothing was written or run."],
      ),
    );
    expect(existsSync(join(stateDir, "no-instructions"))).toBe(true);
    const result = run(["setup", "--instructions"]);
    expect(result.stdout).toBe(
      setupStdout(
        SETUP_HEADING,
        [
          "✓ Instructions          4 changes",
          OPT_OUT_CLEARED,
          ...INSTRUCTIONS_CREATED,
          ...MCP_TAVILY_ONLY,
        ],
        [`! Done: 4 changes, with 1 warning to read above. ${BACKUPS}`],
        [RESTART_STEP],
      ),
    );
    expect(run(["setup"]).stdout).toBe(NOTHING_TO_CHANGE);
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

/**
 * doctor's lines that `keep` picks, without their group's indent, each followed by the `Fix:`
 * line under it: what a test of a few lines compares.
 */
function doctorLines(stdout: string, keep: (line: string) => boolean): string[] {
  const lines = stdout.split("\n");
  const picked: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.trimStart().startsWith("Fix: ") || !keep(line)) continue;
    picked.push(line.trim());
    const next = lines[index + 1] ?? "";
    if (next.trimStart().startsWith("Fix: ")) picked.push(next.trim());
  }
  return picked;
}

describe("cc-smart-dev-kit doctor", () => {
  test("all green after setup, through the launcher; git reads the marketplace over SSH", () => {
    const { home, run, gitCalls } = setup();
    run(["setup"]);
    // Setup asked git about the project it ran in (none: the fake knows no repo).
    const afterSetup = gitCalls().length;
    const result = run(["doctor"]);
    // A passing machine: each group folds to its one line, and keeps only its notes (`·`).
    // Plain output (a pipe), so no colour, no progress line and no wrapping.
    expect(result.stdout).toBe(
      [
        `cc-smart-dev-kit ${VERSION}: checking this machine`,
        "",
        "✓ The plugin         6 passed, 1 note",
        // The portal starts with the next session: information, not a failure.
        "  · the portal is not running; it starts with the next Claude Code session, or now: cc-smart-dev-kit portal",
        "✓ Updates            3 passed, 1 note",
        // The self-update has not checked yet: information, not a failure.
        "  · background update: no check yet (a new Claude session checks, at most once an hour)",
        "✓ Companion plugins  4 passed, 1 note",
        // Warp is optional.
        "  · Warp: not installed (optional: cc-smart-dev-kit setup --warp)",
        "✓ MCP servers        2 passed, 1 note",
        // Tavily is optional: without a key its server is skipped, never a failure.
        `  ${tavilyDoctorSkipped(home)}`,
        "✓ Browser            6 passed, 1 note",
        // Chrome closed is the state a restart leaves: the first browser call starts it.
        '  · Google Chrome is not running: the first browser call starts it in the "claude-code" profile',
        "✓ Alerts and limits  1 passed, 1 note",
        "  · retry watchdog: on (set by cc-smart-dev-kit): a session waits and retries at a limit; turn it off with: cc-smart-dev-kit setup --no-retry-watchdog",
        // The gateway is optional: never set up is information, not a failure.
        "· Gateway            1 note",
        "  · gateway: not set up (optional). To use it: cc-smart-dev-kit gateway setup",
        "",
        "✓ Everything works: 22 checks passed.",
        "To see the 22 lines that passed too: cc-smart-dev-kit doctor --verbose",
        "",
      ].join("\n"),
    );
    expect(result.exitCode).toBe(0);
    const doctorGitCalls = gitCalls().slice(afterSetup);
    // `--verbose` opens every group: each line that passed, under its group's line.
    const verbose = run(["doctor", "--verbose"]).stdout;
    for (const line of [
      // The bun running the tests: the preload stops one older than 1.4.3.
      `✓ Bun ${Bun.version} at ${process.execPath} (cc-smart-dev-kit needs ≥ 1.4.3)`,
      `✓ cc-smart-dev-kit@cc-smart-dev-kit ${VERSION} is installed at ~/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/${VERSION}`,
      `✓ the installed version ${VERSION} is up to date with the marketplace`,
      `✓ the launcher ~/.local/bin/cc-smart-dev-kit runs cc-smart-dev-kit ${VERSION}`,
      INSTRUCTIONS_OK,
      "✓ can read the marketplace at git@github.com:example-org/cc-smart-dev-kit.git",
      "✓ Claude Code's own plugin auto-update is off: cc-smart-dev-kit's own check updates the plugin",
      "✓ plugin updates are on",
      "✓ no other enabled plugin is named cc-smart-dev-kit",
      "✓ claude-mem@thedotmack 13.39.0 is installed and on",
      "✓ frontend-design@claude-plugins-official 8f814f49002f is installed and on",
      // D23: claude-mem's two start blocks off, and Claude Code's own task tools on.
      "✓ claude-mem's start blocks in ~/.claude-mem/settings.json: work state is off (set by cc-smart-dev-kit setup), memory-use block is off (set by cc-smart-dev-kit setup)",
      '✓ Claude Code\'s task tools are on for sessions: env.CLAUDE_CODE_ENABLE_TODO_TOOLS is "1" in ~/.claude/settings.json',
      ...MCP_DOCTOR_OK,
      // The browser's own lines. This world's Chrome is the path it claims (host.exists is
      // the whole truth there), and the profile, the extension and the token are its own.
      `✓ Google Chrome is at ${CHROME_ON_PATH}`,
      `✓ the Chrome profile "claude-code" is at ${join(browserChromeDir(home), "claude-code")} (found by its folder)`,
      "✓ the Playwright extension 0.4.0 is installed in that profile",
      "✓ no other extension is in that profile",
      "✓ that profile lets the extension open file:// pages",
      `✓ the browser token is set (${join(home, ".config", "cc-smart-dev-kit", "playwright-extension.token")}, mode 600)`,
      `✓ agent view's notification hook is set in ~/.claude/settings.json: "$HOME/.local/bin/cc-smart-dev-kit" hook notify`,
    ]) {
      expect(verbose).toContain(`\n  ${line}\n`);
    }
    expect(verbose).not.toContain("--verbose");
    expect(verbose).toEndWith("\n✓ Everything works: 22 checks passed.\n");
    // git is asked for the user's own ssh command, then told never to ask for a password.
    // Then which project the folder is in (this fake git says: none) — once for the project
    // group, once by the gateway's project list (the portal's own reader, GP4a: the doctor
    // asks it about every known project, and that reader finds the folder's checkout too).
    expect(doctorGitCalls).toBe(
      [
        "config --get core.sshCommand | prompt=0 | ssh=",
        "ls-remote git@github.com:example-org/cc-smart-dev-kit.git HEAD | prompt=0 | ssh=ssh -o BatchMode=yes -o ConnectTimeout=8",
        "rev-parse --path-format=absolute --show-toplevel --absolute-git-dir --git-common-dir | prompt= | ssh=",
        "rev-parse --path-format=absolute --show-toplevel --absolute-git-dir --git-common-dir | prompt= | ssh=",
        "",
      ].join("\n"),
    );
  });

  test("--json: the whole report for a program, every check with its group, a failure with its fix", () => {
    const { run } = setup();
    // No setup: no launcher and no instructions, so the report holds failures.
    const result = run(["doctor", "--json"]);
    expect(result.exitCode).toBe(1);
    // Nothing but the JSON: no heading, no verdict, no progress line.
    expect(result.stdout.startsWith("{\n")).toBe(true);
    const report = JSON.parse(result.stdout) as DoctorReport;
    expect(report.format).toBe(1);
    expect(report.version).toBe(VERSION);
    expect(report.ok).toBe(false);
    expect(report.groups.map((group) => group.id)).toEqual([
      "plugin",
      "updates",
      "companions",
      "mcp",
      "browser",
      "alerts",
      "gateway",
    ]);
    const plugin = report.groups[0];
    expect(plugin?.title).toBe("The plugin");
    expect(plugin?.status).toBe("fail");
    expect(plugin?.checks.find((check) => check.text.startsWith("no launcher"))).toEqual({
      fix: "cc-smart-dev-kit setup",
      status: "fail",
      text: "no launcher at ~/.local/bin/cc-smart-dev-kit",
    });
    // Every failure carries its fix; the counts are the checks' own.
    const all = report.groups.flatMap((group) => group.checks);
    for (const check of all.filter((one) => one.status === "fail")) {
      expect(check.fix).toBeString();
    }
    expect(report.counts.fail).toBe(all.filter((one) => one.status === "fail").length);
    expect(report.counts.ok + report.counts.fail + report.counts.warn + report.counts.info).toBe(
      all.length,
    );
    // After setup: the same shape, and ok.
    run(["setup"]);
    const fine = run(["doctor", "--json"]);
    expect(fine.exitCode).toBe(0);
    expect((JSON.parse(fine.stdout) as DoctorReport).ok).toBe(true);
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
    const result = run(["doctor", "--verbose"], { TMUX: "/tmp/tmux-1001/default,1234,0" });
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
    expect(
      run(["doctor", "--verbose"], { TMUX: "/tmp/tmux-1001/default,1234,0" }).stdout,
    ).not.toContain("tmux");

    // Outside tmux the running server is not read: only the config file is checked.
    writeFileSync(join(home, ".tmux.conf"), "");
    expect(
      run(["doctor", "--verbose"], { TMUX: "" })
        .stdout.split("\n")
        .filter((line) => line.includes("tmux")),
    ).toEqual([
      '  · ~/.tmux.conf has no "set -g allow-passthrough all" line, so tmux drops an alert from a pane. To add it: cc-smart-dev-kit setup',
    ]);
  });

  test("the Linux desktop extras: a missing tool is named as information, and no desktop means no line", () => {
    const { fakeBin, run } = setup();
    run(["setup"]);
    // No DISPLAY: an SSH session or a headless machine — nothing about the desktop at all.
    expect(run(["doctor", "--verbose"]).stdout).not.toContain("xdotool");
    // A desktop with none of the extras' tools: one line each, information, never a failure.
    const desktop = run(["doctor", "--verbose"], { DISPLAY: ":0", XDG_CURRENT_DESKTOP: "XFCE" });
    expect(desktop.exitCode).toBe(0);
    expect(desktop.stdout).toContain(
      "· gdbus is not installed (glib's libglib2.0-bin provides it): a desktop alert has no minute on screen, and two alerts of one session can stay there together\n",
    );
    expect(desktop.stdout).toContain(
      "· xdotool is not installed: a click on a desktop alert cannot raise the session's terminal window\n",
    );
    expect(desktop.stdout).toContain(
      "· xfconf-query is not installed: an alert's sound plays while XFCE's Do Not Disturb is on\n",
    );
    // Another desktop (or none named): the XFCE setting is not this machine's to miss.
    expect(
      run(["doctor", "--verbose"], { DISPLAY: ":0", XDG_CURRENT_DESKTOP: "GNOME" }).stdout,
    ).not.toContain("xfconf-query");
    // The tools installed: nothing about them.
    for (const tool of ["gdbus", "xdotool", "xfconf-query"]) {
      writeFileSync(join(fakeBin, tool), "#!/bin/sh\nexit 0\n");
      chmodSync(join(fakeBin, tool), 0o755);
    }
    const complete = run(["doctor", "--verbose"], { DISPLAY: ":0", XDG_CURRENT_DESKTOP: "XFCE" });
    expect(complete.stdout).not.toContain("gdbus");
    expect(complete.stdout).not.toContain("xdotool");
    expect(complete.stdout).not.toContain("xfconf-query");
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
    const registryAsked: string[] = [];
    // An OmniRoute of this test's own, so `doctor`'s own OmniRoute check has something to find.
    const omniroute = join(home, ".bun", "install", "global", "node_modules", "omniroute");
    mkdirSync(join(omniroute, "bin"), { recursive: true });
    writeFileSync(
      join(omniroute, "package.json"),
      `${JSON.stringify({ bin: { omniroute: "bin/omniroute.mjs" }, name: "omniroute", version: "3.8.51" })}\n`,
    );
    writeFileSync(join(omniroute, "bin", "omniroute.mjs"), "// the program\n");
    // doctor's Warp check reads nothing of the host this test runs on.
    const fakeMachine = noHostMachine(home, null);
    // A pipe's terminal: plain words, so the text below is exactly what a log would hold.
    let printed = "";
    const out = createOut(
      detectTerminal({ env: {}, isTTY: false, platform: "linux" }),
      textSink((text) => {
        printed += text;
      }),
    );
    let exitCode: number;
    try {
      exitCode = await runDoctor(
        paths,
        {},
        {
          bun: { path: "/opt/bun/bin/bun", version: "1.4.2" },
          gateway: {
            bundle: join(home, "router.js"),
            // The OmniRoute check asks the npm registry, and looks in the machine's own
            // `/usr/.../node_modules` for a global install. This test has an OmniRoute of its
            // own in the temp home, so that check really runs — through the fake registry and
            // with no system folders, never the host's.
            fetch: async (url) => {
              registryAsked.push(String(url));
              return Response.json({ time: {}, versions: {} });
            },
            runner: (cmd) => {
              ran.push(cmd);
              return { exitCode: 0, output: "" };
            },
            systemFolders: [],
            service: "systemd",
            machine: fakeMachine,
          },
          local: { instructionsSource: join(home, "no-instructions-source"), cwd: home },
          project: null,
          live: null,
        },
        out,
      );
    } finally {
      fake.stop(true);
    }
    // A group with a failure opens: every line, each failure with its Fix: line under it. A
    // group that passed folds to its line and its notes. Then the verdict, in words.
    expect(printed).toBe(
      [
        `cc-smart-dev-kit ${VERSION}: checking this machine`,
        "",
        "✗ The plugin         3 to fix, 3 passed",
        "  ✗ cc-smart-dev-kit needs Bun ≥ 1.4.3; this is 1.4.2 (/opt/bun/bin/bun)",
        "    Fix: upgrade this Bun (bun upgrade), then run: cc-smart-dev-kit doctor",
        `  ✓ cc-smart-dev-kit@cc-smart-dev-kit ${VERSION} is installed at ~/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/${VERSION}`,
        `  ✓ the installed version ${VERSION} is up to date with the marketplace`,
        "  ✗ no launcher at ~/.local/bin/cc-smart-dev-kit",
        "    Fix: cc-smart-dev-kit setup",
        "  ✗ the instructions are not installed in ~/.claude/cc-smart-dev-kit/instructions/",
        "    Fix: cc-smart-dev-kit setup",
        "  ✓ no other enabled plugin is named cc-smart-dev-kit",
        "✓ Updates            3 passed, 1 note",
        "  · background update: no check yet (a new Claude session checks, at most once an hour)",
        "✗ Companion plugins  1 to fix, 2 passed, 1 note",
        "  ✓ claude-mem@thedotmack 13.39.0 is installed and on",
        "  ✓ frontend-design@claude-plugins-official 8f814f49002f is installed and on",
        // No setup ran here: claude-mem's two start blocks are still on (D23).
        "  ✗ claude-mem's start blocks in ~/.claude-mem/settings.json: work state is on (claude-mem's default), memory-use block is on (claude-mem's default). Together they overflow Claude Code's start context in about one start in six",
        "    Fix: cc-smart-dev-kit setup",
        "  · Warp: not installed (optional: cc-smart-dev-kit setup --warp)",
        "✗ Alerts and limits  1 to fix, 1 note",
        "  ✗ agent view's notification hook is missing from ~/.claude/settings.json, so agent view's alerts never arrive",
        "    Fix: cc-smart-dev-kit setup",
        "  · retry watchdog: off, so a session fails at a limit instead of waiting; to turn it on, run: cc-smart-dev-kit setup --retry-watchdog",
        "· Gateway            1 note",
        "  · gateway: not checked on this Bun (its checks send the backend key)",
        "",
        "✗ 5 to fix, 8 passed. Run each Fix: line above, then: cc-smart-dev-kit doctor",
        "To see the 3 lines that passed too: cc-smart-dev-kit doctor --verbose",
        "",
      ].join("\n"),
    );
    expect(exitCode).toBe(1);
    expect(seen).toEqual([]);
    expect(ran).toEqual([]);
    // The registry was asked through the test's own `fetch`, never the real one.
    expect(registryAsked).toEqual(["https://registry.npmjs.org/omniroute"]);
  });

  test("the host is the test's: a macOS with the Warp app (given, not read) is information, and setup leaves Warp alone", () => {
    const { home, run } = setup();
    const macApp = join(home, "Applications", "Warp.app");
    mkdirSync(macApp, { recursive: true });
    // The browser as macOS keeps it, so `doctor` reads this world and never the host's Chrome.
    const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const macProfile = join(
      home,
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "claude-code",
    );
    mkdirSync(join(macProfile, "Extensions", PLAYWRIGHT_EXTENSION_ID, "0.4.0"), {
      recursive: true,
    });
    writeFileSync(
      join(macProfile, "Preferences"),
      JSON.stringify({
        extensions: { settings: { [PLAYWRIGHT_EXTENSION_ID]: { newAllowFileAccess: true } } },
      }),
    );
    const host = {
      [TEST_HOST_VAR]: JSON.stringify({
        existing: [
          macApp,
          macChrome,
          macProfile,
          join(home, ".config", "cc-smart-dev-kit", "playwright-extension.token"),
        ],
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
    const result = run(["doctor", "--verbose"], host);
    expect(result.stdout).toContain(
      "· Warp is installed, without its Claude plugin (optional: cc-smart-dev-kit setup --warp)\n",
    );
    expect(result.exitCode).toBe(0);
  });

  test("no access to the marketplace: ✗ naming both URLs tried, exit 1", () => {
    const { run, gitCalls } = setup({ gitOk: false });
    run(["setup"]);
    const result = run(["doctor", "--verbose"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ cannot read the marketplace (" +
        "git@github.com:example-org/cc-smart-dev-kit.git: fatal: unable to access 'https://***@git.example.com/r.git/': 403; " +
        "https://github.com/example-org/cc-smart-dev-kit.git: fatal: unable to access 'https://***@git.example.com/r.git/': 403)\n" +
        "    Fix: check your git access: an SSH key, or a git credential helper\n",
    );
    expect(gitCalls().match(/ls-remote/g)).toHaveLength(2);
  });

  test("no GitHub SSH key: ✗ names ssh, and the HTTPS add that works instead", () => {
    // Live, 2026-10-17: Claude Code adds a marketplace over ssh, and a machine with no GitHub
    // SSH key is refused. The line that names the cause is the first of git's, not its last.
    const { run } = setup({
      gitOk: false,
      gitStderr:
        "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
    });
    run(["setup"]);
    const result = run(["doctor", "--verbose"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ cannot read the marketplace (" +
        "git@github.com:example-org/cc-smart-dev-kit.git: fatal: Could not read from remote repository.; " +
        "https://github.com/example-org/cc-smart-dev-kit.git: fatal: Could not read from remote repository.)\n" +
        "    Fix: SSH to GitHub was refused: add the marketplace over HTTPS instead. " +
        "Run: claude plugin marketplace add https://github.com/example-org/cc-smart-dev-kit.git",
    );
  });

  test("the account cannot see the repository: ✗ names the owner and the invitation", () => {
    // The other live failure: the GitHub account this machine is logged in with cannot see the
    // private repository at all — over either URL.
    const { run } = setup({
      gitOk: false,
      gitStderr:
        "ERROR: Repository not found.\nfatal: Could not read from remote repository.\n" +
        "Please make sure you have the correct access rights\nand the repository exists.",
    });
    run(["setup"]);
    const result = run(["doctor", "--verbose"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ cannot read the marketplace (" +
        "git@github.com:example-org/cc-smart-dev-kit.git: and the repository exists.; " +
        "https://github.com/example-org/cc-smart-dev-kit.git: and the repository exists.)\n" +
        "    Fix: The GitHub account cannot read the repository: ask the repository's owner for read " +
        "access, then accept the invitation at " +
        "https://github.com/example-org/cc-smart-dev-kit/invitations.",
    );
  });

  test("a marketplace URL with a token: the token is never printed", () => {
    const source = {
      source: "git",
      url: "https://bot:secret-token@git.example.com/tools.git?x=1",
    };
    const ok = setup({ source }).run(["doctor", "--verbose"]);
    expect(ok.stdout).toContain(
      "✓ can read the marketplace at https://***@git.example.com/tools.git?***\n",
    );
    const failed = setup({ source, gitOk: false }).run(["doctor", "--verbose"]);
    expect(failed.stdout).toContain(
      "✗ cannot read the marketplace (https://***@git.example.com/tools.git?***: fatal:",
    );
    expect(`${ok.stdout}${failed.stdout}`).not.toContain("secret-token");
  });

  test("the marketplace is not added: ✗ with the add command", () => {
    const { configDir, run } = setup();
    writeFileSync(join(configDir, "plugins", "known_marketplaces.json"), "{}");
    const result = run(["doctor", "--verbose"]);
    expect(result.stdout).toContain(
      `✗ the cc-smart-dev-kit marketplace is not added\n    Fix: claude plugin marketplace add ${MARKETPLACE_SOURCE}\n`,
    );
  });

  test("the installed version is behind the marketplace: ✗ with the update command", () => {
    // A newer minor of this major: the self-update installs it by itself.
    const newerMinor = `${VERSION.split(".")[0]}.99.0`;
    const { run } = setup({ marketplaceVersion: newerMinor });
    run(["setup"]);
    const result = run(["doctor", "--verbose"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      `✗ installed ${VERSION}, marketplace has ${newerMinor}\n    Fix: claude plugin update cc-smart-dev-kit@cc-smart-dev-kit\n`,
    );
  });

  test("D33: a new major version in the marketplace: a · line naming update, never `claude plugin update`", () => {
    const { run } = setup({ marketplaceVersion: "99.0.0" });
    run(["setup"]);
    const result = run(["doctor", "--verbose"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `· installed ${VERSION}; 99.0.0 is a major version: it waits for \`cc-smart-dev-kit update\`\n`,
    );
    expect(result.stdout).not.toContain("Run: claude plugin update");
  });

  test("the marketplace's local copy has no plugin manifest: ✗ with the marketplace update command", () => {
    const { run } = setup({ marketplaceVersion: null });
    run(["setup"]);
    const result = run(["doctor", "--verbose"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ cannot read the version in ~/.claude/plugins/marketplaces/cc-smart-dev-kit/plugin/.claude-plugin/plugin.json\n" +
        "    Fix: claude plugin marketplace update cc-smart-dev-kit\n",
    );
  });

  test.each(["DISABLE_AUTOUPDATER", "DISABLE_UPDATES", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"])(
    "%s set: ✗ naming it; with FORCE_AUTOUPDATE_PLUGINS too: ✓",
    (name) => {
      const { run } = setup();
      run(["setup"]);
      const off = run(["doctor", "--verbose"], { [name]: "1" });
      expect(off.exitCode).toBe(1);
      expect(off.stdout).toContain(
        `✗ plugin updates are switched off: ${name} (in your environment) is set, so the background update skips them too\n` +
          `    Fix: set FORCE_AUTOUPDATE_PLUGINS=1 as well, or remove ${name}\n`,
      );
      const forced = run(["doctor", "--verbose"], { [name]: "1", FORCE_AUTOUPDATE_PLUGINS: "1" });
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
    expect(run(["doctor", "--verbose"], { DISABLE_AUTOUPDATER: "0" }).stdout).toContain(
      "✗ plugin updates are switched off: DISABLE_UPDATES (in the env of ~/.claude/settings.json) is set, so the background update skips them too\n" +
        "    Fix: set FORCE_AUTOUPDATE_PLUGINS=1 as well, or remove DISABLE_UPDATES\n",
    );
  });

  test("a launcher baked with another bun than the one running doctor is not out of date", () => {
    const { stateDir, binDir, run } = setup();
    run(["setup"]);
    // The same bun under another path, as when setup ran with another bun first on PATH.
    const otherBun = join(tempDir("other-bun"), "bun");
    symlinkSync(process.execPath, otherBun);
    installLauncher(binDir, { stateDir, bunPath: otherBun });
    const result = run(["doctor", "--verbose"]);
    expect(result.stdout).toContain(
      `✓ the launcher ~/.local/bin/cc-smart-dev-kit runs cc-smart-dev-kit ${VERSION}\n`,
    );
  });

  test("the launcher's baked bun is gone: ✗ with the setup command", () => {
    const { stateDir, binDir, run } = setup();
    run(["setup"]);
    const gone = join(tempDir("gone"), "bun");
    installLauncher(binDir, { stateDir, bunPath: gone });
    const result = run(["doctor", "--verbose"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      `✗ the launcher's bun ${gone} is missing or not executable\n    Fix: cc-smart-dev-kit setup\n`,
    );
  });

  test("a launcher someone edited is out of date", () => {
    const { launcher, run } = setup();
    run(["setup"]);
    writeFileSync(launcher, `${readFileSync(launcher, "utf8")}# edited\n`);
    expect(run(["doctor", "--verbose"]).stdout).toContain(
      "✗ the launcher ~/.local/bin/cc-smart-dev-kit is out of date\n    Fix: cc-smart-dev-kit setup\n",
    );
  });

  test("before setup: no launcher, exit 1; with no key and no record, Claude Code's own auto-update is off", () => {
    const { run } = setup();
    const result = run(["doctor", "--verbose"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("✗ no launcher at ~/.local/bin/cc-smart-dev-kit");
    expect(result.stdout).toContain(
      "✓ Claude Code's own plugin auto-update is off: cc-smart-dev-kit's own check updates the plugin\n",
    );
  });

  describe("D39: Claude Code's own plugin auto-update", () => {
    const RISK = "a major version would install with no hold";
    const KEY = 'extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate';

    test("an older setup's own true: ✗, and setup is the fix", () => {
      const { stateDir, settingsFile, run } = setup();
      run(["setup"]);
      const settings = readJson(settingsFile);
      settings.extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate = true;
      writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
      const ownedFile = join(stateDir, "owned.json");
      writeFileSync(
        ownedFile,
        readFileSync(ownedFile, "utf8").replace('"value": false', '"value": true'),
      );
      const result = run(["doctor", "--verbose"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain(
        `✗ Claude Code's own plugin auto-update is on (${KEY} is true in ~/.claude/settings.json, set by an older setup): ${RISK}\n    Fix: cc-smart-dev-kit setup\n`,
      );
    });

    test("a true the person set: ✗, removed by hand, then setup", () => {
      const { settingsFile, run } = setup();
      const settings = readJson(settingsFile);
      settings.extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate = true;
      writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
      const result = run(["doctor", "--verbose"]);
      expect(result.stdout).toContain(
        `✗ Claude Code's own plugin auto-update is on (${KEY} is true in ~/.claude/settings.json, not set by cc-smart-dev-kit): ${RISK}\n    Fix: remove that key from ~/.claude/settings.json by hand, then run: cc-smart-dev-kit setup\n`,
      );
    });

    test("no key, but Claude Code's own record still says true: ✗, and setup is the fix", () => {
      const { configDir, run } = setup();
      const known = join(configDir, "plugins", "known_marketplaces.json");
      const record = readJson(known);
      record["cc-smart-dev-kit"].autoUpdate = true;
      writeFileSync(known, JSON.stringify(record));
      const result = run(["doctor", "--verbose"]);
      expect(result.stdout).toContain(
        `✗ Claude Code's own plugin auto-update is on (its own record, ~/.claude/plugins/known_marketplaces.json, says so): ${RISK}\n    Fix: cc-smart-dev-kit setup\n`,
      );
    });

    test("an explicit false wins over the record's true: ✓", () => {
      const { configDir, run } = setup();
      run(["setup"]);
      const known = join(configDir, "plugins", "known_marketplaces.json");
      const record = readJson(known);
      record["cc-smart-dev-kit"].autoUpdate = true;
      writeFileSync(known, JSON.stringify(record));
      expect(run(["doctor", "--verbose"]).stdout).toContain(
        "✓ Claude Code's own plugin auto-update is off: cc-smart-dev-kit's own check updates the plugin\n",
      );
    });

    test("a settings file that is not valid JSON: ✗, naming the file", () => {
      const { settingsFile, run } = setup();
      writeFileSync(settingsFile, "{ not json");
      expect(run(["doctor", "--verbose"]).stdout).toContain(
        `✗ cannot read Claude Code's plugin auto-update: ${settingsFile} is not valid JSON`,
      );
    });
  });

  test("not installed: one ✗ for it, and no version line", () => {
    const { configDir, run } = setup();
    rmSync(join(configDir, "plugins", "installed_plugins.json"));
    const result = run(["doctor", "--verbose"]);
    expect(result.stdout).toContain(
      "✗ the cc-smart-dev-kit@cc-smart-dev-kit plugin is not installed\n    Fix: claude plugin install cc-smart-dev-kit@cc-smart-dev-kit\n",
    );
    expect(result.stdout).not.toContain("marketplace has");
    expect(result.stdout).not.toContain("not behind");
  });

  test("the old plugin id is still enabled: ✗ naming it, with the uninstall command", () => {
    const { settingsFile, run } = setup();
    run(["setup"]);
    const before = run(["doctor", "--verbose"]);
    expect(before.stdout).not.toContain("cc@cc-agentic");
    const settings = readJson(settingsFile);
    settings.enabledPlugins["cc@cc-agentic"] = true;
    writeFileSync(settingsFile, JSON.stringify(settings));
    const result = run(["doctor", "--verbose"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ the old plugin cc@cc-agentic is still enabled: two copies of the same hooks would run\n    Fix: claude plugin uninstall cc@cc-agentic\n",
    );
    // Disabled (false) is no clash.
    settings.enabledPlugins["cc@cc-agentic"] = false;
    writeFileSync(settingsFile, JSON.stringify(settings));
    expect(run(["doctor", "--verbose"]).stdout).not.toContain("cc@cc-agentic");
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
    const result = run(["doctor", "--verbose"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ the old plugin cc@cc-agentic (before 0.2.0) left the plugin enabled, its launcher ~/.local/bin/cc-agentic, extraKnownMarketplaces.cc-agentic in ~/.claude/settings.json\n" +
        "    Fix: run `cc-agentic restore` first, then `claude plugin uninstall cc@cc-agentic`, then `claude plugin marketplace remove cc-agentic`\n",
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
    const result = run(["doctor", "--verbose"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ the old plugin cc@cc-agentic (before 0.2.0) left the plugin installed, its launcher ~/.local/bin/cc-agentic, the cc-agentic marketplace\n" +
        '    Fix: its launcher cannot run, so remove by hand ~/.local/bin/cc-agentic and "cc-agentic" under extraKnownMarketplaces in ~/.claude/settings.json; then run `claude plugin uninstall cc@cc-agentic`, then `claude plugin marketplace remove cc-agentic`\n',
    );
  });

  test("the old state folder with nothing else left: no line", () => {
    const { configDir, run } = setup();
    run(["setup"]);
    oldSetupRan(configDir);
    expect(run(["doctor", "--verbose"]).stdout).not.toContain("cc-agentic");
  });

  test("another plugin named cc-smart-dev-kit is enabled: ✗, exit 1", () => {
    const { settingsFile, run } = setup();
    run(["setup"]);
    const settings = readJson(settingsFile);
    settings.enabledPlugins["cc-smart-dev-kit@someone-else"] = true;
    writeFileSync(settingsFile, JSON.stringify(settings));
    const result = run(["doctor", "--verbose"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ another plugin named cc-smart-dev-kit is enabled: cc-smart-dev-kit@someone-else",
    );
  });
});

describe("cc-smart-dev-kit doctor: the instructions", () => {
  /** doctor's lines, without the ones for other checks. */
  const instructionLines = (stdout: string) =>
    doctorLines(stdout, (line) => /instructions|CLAUDE\.md/.test(line));

  test("left out by choice: information, not a failure", () => {
    const { run } = setup();
    run(["setup", "--no-instructions"]);
    const result = run(["doctor", "--verbose"]);
    expect(instructionLines(result.stdout)).toEqual([
      "· instructions: left out (cc-smart-dev-kit setup --no-instructions). To add them: cc-smart-dev-kit setup --instructions",
    ]);
    expect(result.exitCode).toBe(0);
  });

  test("never installed: ✗ with the setup command", () => {
    const { run } = setup();
    expect(instructionLines(run(["doctor", "--verbose"]).stdout)).toEqual([
      "✗ the instructions are not installed in ~/.claude/cc-smart-dev-kit/instructions/",
      "Fix: cc-smart-dev-kit setup",
    ]);
  });

  test("a copy someone edited: ✗ naming the file, exit 1", () => {
    const { stateDir, run } = setup();
    run(["setup"]);
    writeFileSync(join(stateDir, "instructions", "core.md"), "# Edited by hand\n");
    const result = run(["doctor", "--verbose"]);
    expect(instructionLines(result.stdout)).toEqual([
      "✗ the instructions copy ~/.claude/cc-smart-dev-kit/instructions/ is not this plugin version's (core.md differs)",
      "Fix: cc-smart-dev-kit setup",
    ]);
    expect(result.exitCode).toBe(1);
  });

  test("a copy another plugin version wrote: ✗ naming that version, exit 1", () => {
    const { stateDir, run } = setup();
    run(["setup"]);
    writeFileSync(versionStampFile(stateDir), "0.0.1\n");
    const result = run(["doctor", "--verbose"]);
    expect(instructionLines(result.stdout)).toEqual([
      "✗ the instructions copy ~/.claude/cc-smart-dev-kit/instructions/ is not this plugin version's (written by 0.0.1)",
      "Fix: cc-smart-dev-kit setup",
    ]);
    expect(result.exitCode).toBe(1);
  });

  test("the block was taken out of CLAUDE.md by hand: ✗ with the setup command", () => {
    const { configDir, run } = setup();
    run(["setup"]);
    writeFileSync(join(configDir, "CLAUDE.md"), "# Mine\n");
    expect(instructionLines(run(["doctor", "--verbose"]).stdout)).toEqual([
      "✗ ~/.claude/CLAUDE.md does not import the instructions (its cc-smart-dev-kit block is missing or changed)",
      "Fix: cc-smart-dev-kit setup",
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
    doctorLines(stdout, (line) => line.includes("imports ~/"));

  test("an imported cc-smart-dev-kit file that is there: ✓", () => {
    const { home, run } = setup();
    run(["setup"]);
    const cwd = project(
      home,
      "# My app\n\n@~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md\n",
    );
    const result = run(["doctor", "--verbose"], {}, cwd);
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
    const result = run(["doctor", "--verbose"], {}, cwd);
    expect(projectLines(result.stdout)).toEqual([
      "✗ ~/my-app/.claude/CLAUDE.md imports ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md, which is missing: it loads nothing",
      "Fix: cc-smart-dev-kit setup",
    ]);
    expect(result.exitCode).toBe(1);
  });

  test("missing after --no-instructions: information, with the command to add them", () => {
    const { home, run } = setup();
    run(["setup", "--no-instructions"]);
    const cwd = project(home, "@~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md\n");
    const result = run(["doctor", "--verbose"], {}, cwd);
    expect(projectLines(result.stdout)).toEqual([
      "· ~/my-app/CLAUDE.md imports ~/.claude/cc-smart-dev-kit/instructions/optin/worktrees.md, which is missing: it loads nothing while the instructions are left out here. To add them: cc-smart-dev-kit setup --instructions",
    ]);
    expect(result.exitCode).toBe(0);
  });

  test("no cc-smart-dev-kit import: no line", () => {
    const { home, run } = setup();
    run(["setup"]);
    const cwd = project(home, "# My app\n\n@docs/rules.md\n");
    expect(projectLines(run(["doctor", "--verbose"], {}, cwd).stdout)).toEqual([]);
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
  /** The two companions' marketplaces, as setup adds them (each installs its plugin). */
  const COMPANION_MARKETPLACES_ADDED = [
    "  + marketplace thedotmack (thedotmack/claude-mem), which installs claude-mem@thedotmack",
    "  + marketplace claude-plugins-official (anthropics/claude-plugins-official), which installs frontend-design@claude-plugins-official",
  ];

  test("their marketplaces are not added: setup adds each, which installs the plugin", () => {
    const { run, pluginCalls, launcher } = setup({ companions: false });
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      setupStdout(
        SETUP_HEADING,
        [
          "✓ The command           1 change",
          "  + ~/.local/bin/cc-smart-dev-kit: launcher created",
          "✓ Claude Code settings  6 changes, 1 note",
          '  ~ ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> false',
          "  ~ ~/.claude/settings.json: remoteControlAtStartup: (none) -> true",
          ...WATCHDOG_LINES,
          NOTIFY_HOOK_ADDED,
          WATCHDOG_ON_NOTE,
          "✓ Instructions          3 changes",
          ...INSTRUCTIONS_CREATED,
          "✓ Companion plugins     2 changes",
          ...COMPANION_MARKETPLACES_ADDED,
          "! MCP servers           2 changes, 1 warning",
          ...MCP_REGISTERED,
          TAVILY_SKIPPED,
        ],
        [`! Done: 14 changes, with 1 warning to read above. ${BACKUPS}`],
        [RESTART_STEP],
      ),
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
    expect(result.stdout).toContain(
      ["· Companion plugins     2 to change", ...COMPANION_MARKETPLACES_ADDED, ""].join("\n"),
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
    // Each failed step is a ✗ with Claude Code's own words, and the verdict says setup is not done.
    expect(result.stdout).toContain(
      [
        "✗ Companion plugins     2 to fix",
        "  ✗ claude plugin marketplace add thedotmack/claude-mem failed (exit 1): clone failed: no network",
        "  ✗ claude plugin marketplace add anthropics/claude-plugins-official failed (exit 1): clone failed: no network",
        "",
      ].join("\n"),
    );
    expect(result.stdout).toContain(
      `\n✗ Setup is not finished: do what the ✗ and ! lines above say, then run cc-smart-dev-kit setup again. ${BACKUPS}\n`,
    );
    expect(existsSync(launcher)).toBe(true);
  });

  test("no claude on PATH: setup skips only the claude steps, names them, does the rest; exit 1", () => {
    const { run, launcher, settingsFile } = setup({ companions: false, claude: false });
    const result = run(["setup"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe(
      setupStdout(
        SETUP_HEADING,
        [
          "✓ The command           1 change",
          "  + ~/.local/bin/cc-smart-dev-kit: launcher created",
          "✓ Claude Code settings  6 changes, 1 note",
          '  ~ ~/.claude/settings.json: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate: (none) -> false',
          "  ~ ~/.claude/settings.json: remoteControlAtStartup: (none) -> true",
          ...WATCHDOG_LINES,
          NOTIFY_HOOK_ADDED,
          WATCHDOG_ON_NOTE,
          "✓ Instructions          3 changes",
          ...INSTRUCTIONS_CREATED,
          "✗ Companion plugins     1 to fix",
          "  ✗ The claude command is not on PATH, so setup skipped these steps. Run them once it is:",
          "    $ claude plugin marketplace add thedotmack/claude-mem",
          "    $ claude plugin marketplace add anthropics/claude-plugins-official",
          "! MCP servers           3 warnings",
          "  ! The claude command is not on PATH, so playwright was not registered. Run it once it is.",
          "  ! The claude command is not on PATH, so sequential-thinking was not registered. Run it once it is.",
          TAVILY_SKIPPED,
        ],
        [
          `✗ Setup is not finished: do what the ✗ and ! lines above say, then run cc-smart-dev-kit setup again. ${BACKUPS}`,
        ],
        [RESTART_STEP],
      ),
    );
    expect(existsSync(launcher)).toBe(true);
    expect(readJson(settingsFile).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBe(
      false,
    );
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
    const none = missing.run(["doctor", "--verbose"]);
    expect(none.exitCode).toBe(1);
    expect(none.stdout).toContain(
      "✗ the thedotmack marketplace is not added, so claude-mem@thedotmack is missing and cc-smart-dev-kit does not load\n    Fix: cc-smart-dev-kit setup\n" +
        "  ✗ the claude-plugins-official marketplace is not added, so frontend-design@claude-plugins-official is missing and cc-smart-dev-kit does not load\n    Fix: cc-smart-dev-kit setup\n",
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
    const result = run(["doctor", "--verbose"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ claude-mem@thedotmack 13.28.0 is outside >=13.36.0\n    Fix: claude plugin update claude-mem@thedotmack\n" +
        "  ✗ frontend-design@claude-plugins-official is turned off, and cc-smart-dev-kit does not load without it\n    Fix: claude plugin enable frontend-design@claude-plugins-official\n",
    );
  });

  test("a version resolved from a git tag carries a commit suffix; the range is checked without it", () => {
    const { configDir, run } = setup();
    run(["setup"]);
    const installed = join(configDir, "plugins", "installed_plugins.json");
    const plugins = readJson(installed);
    plugins.plugins["claude-mem@thedotmack"][0].version = "13.36.0-8713c5b11005";
    writeFileSync(installed, JSON.stringify(plugins));
    expect(run(["doctor", "--verbose"]).stdout).toContain(
      "✓ claude-mem@thedotmack 13.36.0-8713c5b11005 is installed and on\n",
    );
  });

  test("a version that is a commit id is unknown, not older; setup says it once", () => {
    const { home, configDir, run } = setup();
    const installed = join(configDir, "plugins", "installed_plugins.json");
    const plugins = readJson(installed);
    plugins.plugins["claude-mem@thedotmack"][0].version = "8713c5b11005";
    writeFileSync(installed, JSON.stringify(plugins));
    const unknown =
      "claude-mem@thedotmack 8713c5b11005: its version is unknown (not a version number), so cc-smart-dev-kit cannot check it against >=13.36.0";
    const update = "claude plugin update claude-mem@thedotmack";
    expect(run(["doctor", "--verbose"]).stdout).toContain(`✗ ${unknown}\n    Fix: ${update}\n`);
    // With the gateway there, claude-mem's own check would say it again: it does not.
    writeGatewayConfig(home, "http://127.0.0.1:9");
    const result = run(["setup"]);
    expect(result.stdout).toContain(`! ${unknown}. Run: ${update}\n`);
    expect(result.stdout).not.toContain("older");
    expect(result.stdout).not.toContain("claude-mem settings left alone");
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
          SETUP_HEADING,
          "",
          `Auto mode: trust rules from ${repo}/.claude/cc-smart-dev-kit.json ("autoMode"), for autoMode.environment in ~/.claude/settings.json:`,
          '  + "$defaults"',
          `  + ${JSON.stringify(RULE)}`,
          "",
        ].join("\n"),
      );
      expect(result.stdout).toContain(
        [
          "  ! auto-mode entries left out: they are trust rules, so setup asks first, on a terminal",
          "    Fix: run cc-smart-dev-kit setup in a terminal",
          "",
        ].join("\n"),
      );
      expect(readJson(settingsFile).autoMode).toBeUndefined();
    }
  });

  test("--dry-run, no terminal: the entries as changes, and the note that a run without one leaves them out", () => {
    const repo = project({ autoMode: [RULE] });
    const { settingsFile, stateDir, run } = setup({ fakeGit: false });
    const result = run(["setup", "--dry-run"], GIT_ENV, repo);
    // The entries as changes in their section, then the same line the real run prints: they are
    // left out without a terminal.
    expect(result.stdout).toContain(
      [
        "! Projects              2 to change, 1 warning",
        '  ~ ~/.claude/settings.json: autoMode.environment: added "$defaults"',
        `  ~ ~/.claude/settings.json: autoMode.environment: added ${JSON.stringify(RULE)}`,
        "  ! auto-mode entries left out: they are trust rules, so setup asks first, on a terminal",
        "    Fix: run cc-smart-dev-kit setup in a terminal",
        "",
      ].join("\n"),
    );
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

/**
 * gateway.json with the omniroute backend at `url`, and the chains a person gave the slots
 * (by default the scout's and the worker's, each starting with the affordable model).
 */
function writeGatewayConfig(
  home: string,
  url: string,
  slots: Record<string, string[]> = {
    "cc-smart-dev-kit-scout": [`omniroute:${AFFORDABLE_MODEL}`, "claude-sonnet-5-5"],
    "cc-smart-dev-kit-worker": [`omniroute:${AFFORDABLE_MODEL}`, "claude-sonnet-5-5"],
  },
) {
  const file = join(home, ".config", "cc-smart-dev-kit", "gateway.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      backends: { omniroute: { apiKey: PLANTED_KEY, baseUrl: url } },
      slots,
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

describe("cc-smart-dev-kit setup: claude-mem on the scout slot's affordable model", () => {
  test("claude-mem's defaults become the scout's affordable model, and no fallback model is written; the key never shows; restore takes them out", async () => {
    const { home, run, runAsync } = setup();
    const backend = fakeBackend();
    writeGatewayConfig(home, backend.url);
    const file = writeClaudeMem(home, SEEDED);
    const result = await runAsync(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      [
        '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_PROVIDER: "claude" -> "openai-compatible"',
        '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_PRESET: "" -> "custom"',
        `  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: "" -> "${backend.url}/v1"`,
        `  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_MODEL: "" -> "${AFFORDABLE_MODEL}"`,
        '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "" -> "••••cdef"',
        "",
      ].join("\n"),
    );
    // claude-mem's own quota fallback stays its own: no model of the plugin's is written.
    expect(result.stdout).not.toContain("QUOTA_FALLBACK");
    expect(`${result.stdout}${result.stderr}`).not.toContain(PLANTED_KEY);
    // The key was checked against the backend once, before anything was written.
    expect(backend.seen).toEqual([CHAT_CHECK]);
    expect(readJson(file)).toEqual({
      ...SEEDED,
      // D23: claude-mem's two start blocks, off.
      CLAUDE_MEM_WORK_STATE_ENABLED: "false",
      CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: "false",
      CLAUDE_MEM_PROVIDER: "openai-compatible",
      CLAUDE_MEM_OPENAI_COMPAT_PRESET: "custom",
      CLAUDE_MEM_OPENAI_COMPAT_API_KEY: PLANTED_KEY,
      CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: `${backend.url}/v1`,
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: AFFORDABLE_MODEL,
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);

    // A second run: nothing to change, and no need to ask the backend again.
    expect(run(["setup"]).stdout).toBe(NOTHING_TO_CHANGE);
    expect(backend.seen).toHaveLength(1);

    // Restore takes out the keys setup owns: claude-mem falls back to its own defaults.
    const restored = run(["restore"]);
    expect(`${restored.stdout}${restored.stderr}`).not.toContain(PLANTED_KEY);
    expect(readJson(file)).toEqual({
      CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
      CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "claude",
      CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "",
      CLAUDE_MEM_CONTEXT_OBSERVATIONS: "50",
    });
  });

  test("the quota fallback 0.4.3 wrote is taken out while it is still ours; the person's own fallback stays", async () => {
    const { home, stateDir, runAsync } = setup();
    writeGatewayConfig(home, fakeBackend().url);
    const file = writeClaudeMem(home, SEEDED);
    // What 0.4.3's setup left: its fixed Claude model in claude-mem's fallback, owned.
    applyManagedJson({
      file,
      stateDir,
      set: [[["CLAUDE_MEM_QUOTA_FALLBACK_MODEL"], "claude-haiku-4-5-20251001"]],
      unchosen: () => true,
    });
    const result = await runAsync(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "claude-haiku-4-5-20251001" -> (none)\n',
    );
    const written = readJson(file);
    expect(Object.hasOwn(written, "CLAUDE_MEM_QUOTA_FALLBACK_MODEL")).toBe(false);
    expect(written.CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER).toBe("claude");

    // A person's own fallback: kept as it is, and the rest is set around it.
    const other = setup();
    writeGatewayConfig(other.home, fakeBackend().url);
    const theirs = writeClaudeMem(other.home, {
      ...SEEDED,
      CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "gemini",
      CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "gemini-their-own",
    });
    expect((await other.runAsync(["setup"])).exitCode).toBe(0);
    const kept = readJson(theirs);
    expect(kept.CLAUDE_MEM_PROVIDER).toBe("openai-compatible");
    expect(kept.CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER).toBe("gemini");
    expect(kept.CLAUDE_MEM_QUOTA_FALLBACK_MODEL).toBe("gemini-their-own");
  });

  test("the scout has no chain, or it starts with Claude: claude-mem is not pointed at the gateway", async () => {
    for (const slots of [
      // Only the worker has a chain: claude-mem's work is Haiku's, not Sonnet's.
      { "cc-smart-dev-kit-worker": [`omniroute:${AFFORDABLE_MODEL}`] },
      // The scout asks Claude first: claude-mem stays on Claude too.
      { "cc-smart-dev-kit-scout": ["claude-haiku-4-5-20251001", `omniroute:${AFFORDABLE_MODEL}`] },
    ]) {
      const { home, runAsync } = setup();
      const backend = fakeBackend();
      writeGatewayConfig(home, backend.url, slots);
      const file = writeClaudeMem(home, SEEDED);
      const result = await runAsync(["setup"]);
      // No provider key is written: claude-mem stays on Claude.
      expect(result.stdout).not.toContain("CLAUDE_MEM_PROVIDER");
      expect(result.stdout).not.toContain("CLAUDE_MEM_OPENAI_COMPAT");
      const written = readJson(file);
      expect(written.CLAUDE_MEM_PROVIDER).toBe("claude");
      expect(written.CLAUDE_MEM_OPENAI_COMPAT_PRESET).toBe("");
      // D23's two start blocks do not depend on the gateway: they are set all the same.
      expect(written.CLAUDE_MEM_WORK_STATE_ENABLED).toBe("false");
      expect(written.CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED).toBe("false");
      expect(backend.seen).toEqual([]);
    }
  });

  test("the person chose another provider: the five provider keys stay, and D23's two are set", () => {
    const { home, run } = setup();
    const backend = fakeBackend();
    writeGatewayConfig(home, backend.url);
    const file = writeClaudeMem(home, { ...SEEDED, CLAUDE_MEM_PROVIDER: "gemini" });
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      '  · claude-mem settings left alone: CLAUDE_MEM_PROVIDER is "gemini" in ~/.claude-mem/settings.json (your choice)\n',
    );
    const written = readJson(file);
    // The provider keys stay exactly as the person left them...
    expect(written.CLAUDE_MEM_PROVIDER).toBe("gemini");
    expect(written.CLAUDE_MEM_OPENAI_COMPAT_PRESET).toBe("");
    // ...while D23's two start blocks are still turned off.
    expect(written.CLAUDE_MEM_WORK_STATE_ENABLED).toBe("false");
    expect(written.CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED).toBe("false");
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
      "  · claude-mem settings left alone: CLAUDE_MEM_OPENAI_COMPAT_API_KEY is another key in ~/.claude-mem/settings.json (your choice)\n",
    );
    expect(result.stdout).not.toContain("sk-their-own-key");
  });

  test("the backend refuses the key: the provider keys stay, and D23's two are still set", async () => {
    const { home, runAsync } = setup();
    writeGatewayConfig(home, fakeBackend(401).url);
    const file = writeClaudeMem(home, SEEDED);
    const result = await runAsync(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "  ! claude-mem settings left alone: omniroute refused its key (HTTP 401)\n",
    );
    const written = readJson(file);
    // Nothing of the provider's is written...
    expect(written.CLAUDE_MEM_PROVIDER).toBe("claude");
    expect(written.CLAUDE_MEM_OPENAI_COMPAT_MODEL).toBe("");
    // ...and the two start blocks, which need no backend, are written anyway.
    expect(written.CLAUDE_MEM_WORK_STATE_ENABLED).toBe("false");
    expect(written.CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED).toBe("false");
  });

  test("claude-mem never ran yet: its settings file is made with the five keys and D23's two, mode 600", async () => {
    const { home, run, runAsync } = setup();
    const backend = fakeBackend();
    writeGatewayConfig(home, backend.url);
    expect((await runAsync(["setup"])).exitCode).toBe(0);
    const file = join(home, ".claude-mem", "settings.json");
    expect(readJson(file)).toEqual({
      CLAUDE_MEM_WORK_STATE_ENABLED: "false",
      CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED: "false",
      CLAUDE_MEM_PROVIDER: "openai-compatible",
      CLAUDE_MEM_OPENAI_COMPAT_PRESET: "custom",
      CLAUDE_MEM_OPENAI_COMPAT_BASE_URL: `${backend.url}/v1`,
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: AFFORDABLE_MODEL,
      CLAUDE_MEM_OPENAI_COMPAT_API_KEY: PLANTED_KEY,
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

  test("claude-mem older than 13.29.0: one note (the range check's), the provider keys left alone, D23's two still set", () => {
    const { home, configDir, run } = setup();
    writeGatewayConfig(home, fakeBackend().url);
    const file = writeClaudeMem(home, SEEDED);
    const installed = join(configDir, "plugins", "installed_plugins.json");
    const plugins = readJson(installed);
    plugins.plugins["claude-mem@thedotmack"][0].version = "13.28.0";
    writeFileSync(installed, JSON.stringify(plugins));
    const result = run(["setup"]);
    expect(result.stdout).toContain(
      "  ! claude-mem@thedotmack 13.28.0 is outside >=13.36.0, and cc-smart-dev-kit does not load with it. Run: claude plugin update claude-mem@thedotmack\n",
    );
    expect(result.stdout.match(/13\.28\.0/g)).toHaveLength(1);
    const written = readJson(file);
    // No provider key: that provider came in 13.29.0.
    expect(written.CLAUDE_MEM_PROVIDER).toBe("claude");
    expect(written.CLAUDE_MEM_OPENAI_COMPAT_MODEL).toBe("");
    // Both start blocks are still planned: an unknown key is harmless to an older claude-mem.
    expect(written.CLAUDE_MEM_WORK_STATE_ENABLED).toBe("false");
    expect(written.CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED).toBe("false");
  });

  test("the backend has no chat endpoint (404), or does not serve the model: said so; the key never shows", async () => {
    const cases: Array<[number, unknown, string]> = [
      [
        404,
        "404 page not found",
        "  ! claude-mem settings left alone: omniroute has no OpenAI chat endpoint at URL/v1/chat/completions (HTTP 404)\n",
      ],
      [
        404,
        { error: { code: "model_not_found", message: "The model does not exist" } },
        `  ! claude-mem settings left alone: omniroute does not serve the model ${AFFORDABLE_MODEL} (HTTP 404)\n`,
      ],
      [
        500,
        { error: { message: `upstream rejected ${PLANTED_KEY}` } },
        `  ! claude-mem settings left alone: omniroute answered HTTP 500 to a one-token chat request for ${AFFORDABLE_MODEL} at URL/v1/chat/completions\n`,
      ],
    ];
    for (const [status, body, note] of cases) {
      const { home, runAsync } = setup();
      const backend = fakeBackend(status, body);
      writeGatewayConfig(home, backend.url);
      const file = writeClaudeMem(home, SEEDED);
      const result = await runAsync(["setup"]);
      expect(result.stdout).toContain(note.replace("URL", backend.url));
      expect(result.stdout).not.toContain("refused its key");
      expect(`${result.stdout}${result.stderr}`).not.toContain(PLANTED_KEY);
      const written = readJson(file);
      // The provider keys stay as they were: they point at a backend that failed.
      expect(written.CLAUDE_MEM_PROVIDER).toBe("claude");
      expect(written.CLAUDE_MEM_OPENAI_COMPAT_MODEL).toBe("");
      // D23's two start blocks need no backend: they are written anyway.
      expect(written.CLAUDE_MEM_WORK_STATE_ENABLED).toBe("false");
      expect(written.CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED).toBe("false");
    }
  });

  test("--dry-run reaches no network: it says which backend a real run checks", () => {
    const { home, run } = setup();
    const backend = fakeBackend();
    writeGatewayConfig(home, backend.url);
    writeClaudeMem(home, SEEDED);
    const result = run(["setup", "--dry-run"]);
    expect(result.stdout).toContain(
      "  · claude-mem: would check omniroute (one chat request) before writing its settings\n",
    );
    expect(result.stdout).toContain(
      '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_PROVIDER: "claude" -> "openai-compatible"\n',
    );
    expect(backend.seen).toEqual([]);
  });

  test("a key cc-smart-dev-kit set and the person changed since is theirs: setup leaves all five, restore leaves theirs", async () => {
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
      '  · claude-mem settings left alone: CLAUDE_MEM_OPENAI_COMPAT_MODEL is "my-own-model" in ~/.claude-mem/settings.json (your choice)\n',
    );
    expect(readFileSync(file, "utf8")).toBe(before);
    run(["restore"]);
    expect(readJson(file)).toEqual({
      CLAUDE_MEM_MODEL: "claude-haiku-4-5-20251001",
      CLAUDE_MEM_OPENAI_COMPAT_MODEL: "my-own-model",
      CLAUDE_MEM_QUOTA_FALLBACK_PROVIDER: "claude",
      CLAUDE_MEM_QUOTA_FALLBACK_MODEL: "",
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
      '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_OPENAI_COMPAT_API_KEY: "••••cdef" -> "••••9999"\n',
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
      setupStdout(
        SETUP_HEADING,
        [
          "! Companion plugins     1 warning",
          "  ! claude-mem still uses the backend cc-smart-dev-kit set for it, but the gateway is not set up. Run cc-smart-dev-kit setup again once the scout slot starts with an affordable model, or cc-smart-dev-kit restore to put claude-mem back on its own defaults.",
          ...MCP_TAVILY_ONLY,
        ],
        ["! Nothing to change. Setup is up to date, with 2 warnings to read above."],
      ),
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

  test("a key pool of the person's (CLAUDE_MEM_OPENAI_COMPAT_API_KEYS): the provider keys left alone, never printed; D23's two set", () => {
    const { home, run } = setup();
    const backend = fakeBackend();
    writeGatewayConfig(home, backend.url);
    const file = writeClaudeMem(home, {
      ...SEEDED,
      CLAUDE_MEM_OPENAI_COMPAT_API_KEYS: "sk-pool-one-000000,sk-pool-two-000000",
    });
    const result = run(["setup"]);
    expect(result.stdout).toContain(
      "  · claude-mem settings left alone: CLAUDE_MEM_OPENAI_COMPAT_API_KEYS holds your own keys in ~/.claude-mem/settings.json (your choice)\n",
    );
    expect(result.stdout).not.toContain("sk-pool");
    const written = readJson(file);
    expect(written.CLAUDE_MEM_OPENAI_COMPAT_API_KEYS).toBe("sk-pool-one-000000,sk-pool-two-000000");
    expect(written.CLAUDE_MEM_PROVIDER).toBe("claude");
    expect(written.CLAUDE_MEM_WORK_STATE_ENABLED).toBe("false");
    expect(written.CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED).toBe("false");
    expect(backend.seen).toEqual([]);
  });

  test("a file with only claude-mem's old nested env: left alone, with a note (claude-mem rewrites it flat itself)", () => {
    const { home, run } = setup();
    writeGatewayConfig(home, fakeBackend().url);
    const file = writeClaudeMem(home, { env: SEEDED });
    const before = readFileSync(file, "utf8");
    const result = run(["setup"]);
    expect(result.stdout).toContain(
      "  ! claude-mem settings left alone: ~/.claude-mem/settings.json is in claude-mem's old nested form, which claude-mem rewrites when it next starts. Start a Claude Code session, then run cc-smart-dev-kit setup again.\n",
    );
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  test("no gateway: only the two start blocks are set, and no provider key", () => {
    const { home, run } = setup();
    const file = writeClaudeMem(home, SEEDED);
    const result = run(["setup"]);
    expect(result.stdout).toContain(
      '  ~ ~/.claude-mem/settings.json: CLAUDE_MEM_WORK_STATE_ENABLED: (none) -> "false"\n',
    );
    expect(result.stdout).not.toContain("CLAUDE_MEM_PROVIDER");
    const written = readJson(file);
    expect(written.CLAUDE_MEM_PROVIDER).toBe("claude");
    expect(written.CLAUDE_MEM_OPENAI_COMPAT_MODEL).toBe("");
    expect(written.CLAUDE_MEM_WORK_STATE_ENABLED).toBe("false");
    expect(written.CLAUDE_MEM_MEMORY_INSTRUCTIONS_ENABLED).toBe("false");
  });
});

describe("cc-smart-dev-kit setup: options", () => {
  test("--warp and --remove-warp together, or a --project with no folder: exit 2", () => {
    const { run } = setup();
    expect(run(["setup", "--warp", "--remove-warp"]).exitCode).toBe(2);
    expect(run(["setup", "--project"]).exitCode).toBe(2);
  });

  test("UX-13: a --project folder that is not there is not a usage mistake: exit 1, with a fix", () => {
    const result = setup().run(["setup", "--project", "/no/such/folder"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "Not a folder: /no/such/folder\n" +
        "Fix: give the folder of a project, or leave --project out to use the folder you are in\n",
    );
  });
});

describe("cc-smart-dev-kit version and help", () => {
  test("version prints the plugin version", () => {
    expect(setup().run(["version"]).stdout).toBe(`cc-smart-dev-kit ${VERSION}\n`);
  });

  test("UX-3: an unknown command prints one line and where to read the rest, exit 2", () => {
    const result = setup().run(["nope"]);
    expect(result.exitCode).toBe(2);
    // One line, and the command that explains it: never the wall of help again on stderr.
    expect(result.stderr).toBe(`Unknown command: nope\nSee: ${COMMAND} --help\n`);
    expect(result.stdout).toBe("");
  });

  test("UX-3: a wrong option prints one line and that command's help, exit 2", () => {
    const result = setup().run(["doctor", "--lively"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe(`Unknown option: --lively\nSee: ${COMMAND} doctor --help\n`);
    expect(result.stdout).toBe("");
  });

  test("UX-3: `help <command>` prints that command's help on stdout, exit 0", () => {
    const world = setup();
    expect(world.run(["help", "worktrees"]).stdout).toBe(world.run(["worktrees", "--help"]).stdout);
    expect(world.run(["help", "worktrees"]).exitCode).toBe(0);
    // `help` alone, and no command at all: the top-level help, on stdout.
    expect(world.run(["help"]).stdout).toBe(world.run([]).stdout);
    expect(world.run(["help"]).stdout).toStartWith(`${COMMAND} ${VERSION}: `);
    // A command the table does not know is still an unknown command.
    const unknown = world.run(["help", "nope"]);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stderr).toBe(`Unknown command: nope\nSee: ${COMMAND} --help\n`);
  });

  // One subprocess per command, on a machine other builders share: the default 5 s is the
  // machine's speed, not this test's work, so it gets a minute.
  test("UX-2: every command's and subcommand's --help prints its help and exits 0, running nothing", () => {
    const world = setup();
    for (const row of COMMAND_HELP) {
      const result = world.run([...row.name.split(" "), "--help"]);
      // Each check names the command it read, so a failure points at the row that broke.
      if (result.exitCode !== 0) expect(`${row.name}: exit ${String(result.exitCode)}`).toBe("0");
      if (result.stderr !== "") expect(`${row.name}: stderr`).toBe(`"${result.stderr}"`);
      // `help --help` prints the top-level help, which opens with the version line.
      const prefix = row.name === HELP_COMMAND ? `${COMMAND} ${VERSION}` : `Usage: ${COMMAND}`;
      if (!result.stdout.startsWith(prefix)) expect(`${row.name}: ${result.stdout}`).toBe(prefix);
    }
    // Nothing ran: a scan or a setup would have called the fake git or the fake claude.
    expect(world.gitCalls()).toBe("");
    expect(world.claudeCalls()).toBe("");
  }, 60_000);

  test("UX-2: `worktrees --help` never scans, and a typo is refused instead of run", () => {
    const world = setup();
    const help = world.run(["worktrees", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toStartWith(`Usage: ${COMMAND} worktrees`);
    expect(help.stderr).toBe("");
    expect(world.gitCalls()).toBe("");

    const typo = world.run(["worktrees", "--clena"]);
    expect(typo.exitCode).toBe(2);
    expect(typo.stderr).toBe(`Unknown option: --clena\nSee: ${COMMAND} worktrees --help\n`);
    expect(world.gitCalls()).toBe("");

    // The proof that the fake git would have seen a scan: the command itself calls it.
    world.run(["worktrees"]);
    expect(world.gitCalls()).not.toBe("");
  });

  test("`worktrees --json` prints the list only: it refuses --clean and --remove", () => {
    const world = setup();
    for (const args of [
      ["worktrees", "--json", "--clean"],
      ["worktrees", "--json", "--remove", "/home/user/one-worktree"],
    ]) {
      const refused = world.run(args);
      expect(refused.exitCode).toBe(2);
      expect(refused.stderr).toBe(
        `--json prints the list: it takes neither --clean nor --remove\nSee: ${COMMAND} worktrees --help\n`,
      );
    }
    // The conflict is decided before anything scans or removes.
    expect(world.gitCalls()).toBe("");
  });

  test("UX-17: the help names the commands from the table, so a list cannot drift", () => {
    const world = setup();
    // The top-level help used to list the gateway's subcommands by hand — and missed `check`
    // and `fallback`. It names the command now; the command's own text lists the rest.
    const top = world.run([]).stdout;
    expect(top).not.toContain("status, models, slot");
    expect(top).not.toContain("<worktree-create");
    // Every name the top-level help shows can be asked for its own help: the table's own text,
    // the same text its own `--help` prints (one home, so the two can never drift).
    for (const name of ["gateway setup", "browser setup", "project init"]) {
      // `help gateway setup`: the words of the command name, as a person types them.
      const words = name.split(" ");
      const result = world.run(["help", ...words]);
      expect(`${name}: ${String(result.exitCode)}`).toBe(`${name}: 0`);
      const own = world.run([...words, "--help"]);
      expect(`${name}: ${String(own.exitCode)}`).toBe(`${name}: 0`);
      expect(`${name}: ${result.stdout}`).toBe(`${name}: ${own.stdout}`);
    }
    // The gateway's own module writes `gateway --help`: the row imports it, never copies it,
    // so `check` and `fallback` can never be missing again.
    const gateway = world.run(["gateway", "--help"]);
    expect(gateway.exitCode).toBe(0);
    expect(gateway.stdout).toBe(`${GATEWAY_USAGE}\n`);
    expect(gateway.stdout).toContain("check");
    expect(gateway.stdout).toContain("fallback <slot> on|off");
  });

  test("CM-12: the hook list is the one name left, and the top-level help types none", () => {
    // The worktree engine's names are retired: `notify` is the one hook left, and the help and
    // the refusal both read its constant rather than typing it.
    expect(USER_NOTIFY_HOOK_NAME).toBe("notify");
    const result = setup().run(["hook", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n")[0]).toBe(`Usage: ${COMMAND} hook <${USER_NOTIFY_HOOK_NAME}>`);
    // No engine name survives in the help a person reads.
    expect(result.stdout).not.toContain("worktree-create");
    expect(result.stdout).not.toContain("worktree-remove");
    expect(result.stdout).not.toContain("subagent-stop");
    // The dispatcher's own refusal reads the same name.
    const refused = setup().run(["hook", "git-guard"]);
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain(`Usage: ${COMMAND} hook <${USER_NOTIFY_HOOK_NAME}>`);
    // The list is written once, in the constant: the top-level help does not repeat it.
    expect(setup().run([]).stdout).not.toContain("<worktree-create");
  });

  test("CM-12: the status line's help names the workflow's own warning share, not a typed 85", () => {
    const result = setup().run(["statusline", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`a warning from ${workflowDefaults.alerts.usagePercent} %`);
  });

  test("CM hunch: `worktrees --remove --clean` is refused as a usage mistake, not read as the path", () => {
    const world = setup();
    for (const path of ["--clean", "--no-fetch"]) {
      const result = world.run(["worktrees", "--remove", path]);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toBe(
        `--remove needs the path of one worktree: --remove <path>\nSee: ${COMMAND} worktrees --help\n`,
      );
    }
    expect(world.gitCalls()).toBe("");
  });
});

describe("cc-smart-dev-kit browser token: every path that saves nothing is a failure", () => {
  // The installer reads this command's exit code: a path that saved nothing and exited 0 would
  // let it walk on with no token file, which is how a live machine ended up with a browser that
  // never started (2026-10-17).
  const TOKEN = `${"A".repeat(41)}_-`;
  const tokenFile = (home: string) =>
    join(home, ".config", "cc-smart-dev-kit", "playwright-extension.token");

  test("a token on stdin is saved, 0600, and never printed", () => {
    const world = setup();
    const result = world.run(["browser", "token"], {}, world.home, `${TOKEN}\n`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("the browser token is set");
    expect(readFileSync(tokenFile(world.home), "utf8")).toBe(`${TOKEN}\n`);
    expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN);
  });

  test("a token wrapped in the bracketed-paste markers is saved", () => {
    const world = setup();
    const result = world.run(
      ["browser", "token"],
      {},
      world.home,
      `\u001b[200~${TOKEN}\u001b[201~\r\n`,
    );
    expect(result.exitCode).toBe(0);
    expect(readFileSync(tokenFile(world.home), "utf8")).toBe(`${TOKEN}\n`);
  });

  test("an empty stdin, an empty line, and a wrong shape: each exits 1 and writes nothing", () => {
    // `browser: false`: this world has no token file yet, so "written nothing" is provable.
    const empty = setup({ browser: false });
    const nothing = empty.run(["browser", "token"], {}, empty.home, "");
    expect(nothing.exitCode).toBe(1);
    expect(nothing.stderr).toContain("The token was not saved: nothing was pasted");
    expect(existsSync(tokenFile(empty.home))).toBe(false);

    const blank = setup({ browser: false });
    const emptyLine = blank.run(["browser", "token"], {}, blank.home, "\n");
    expect(emptyLine.exitCode).toBe(1);
    expect(emptyLine.stderr).toContain("nothing was pasted");
    expect(existsSync(tokenFile(blank.home))).toBe(false);

    const wrong = setup({ browser: false });
    const garbage = wrong.run(["browser", "token"], {}, wrong.home, "hello world\n");
    expect(garbage.exitCode).toBe(1);
    expect(garbage.stderr).toContain("The token was not saved");
    expect(garbage.stderr).toContain("11 characters");
    expect(existsSync(tokenFile(wrong.home))).toBe(false);
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
      // This test is about the status line: the retry watchdog was declined before, so it stays off.
      mkdirSync(stateDir, { recursive: true, mode: 0o700 });
      writeFileSync(retryWatchdogDeclinedFile(stateDir), "no\n");
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
              autoUpdate: true,
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
          "cc-smart-dev-kit-opus": {
            lastAt: Date.now(),
            model: "claude-opus-5-5",
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
      "Opus 5.5 · ⚠ claude-opus-5-5 at its limit → omniroute:m1 · 5h 40%\n",
    );
  });

  test("statusline warns at the workflow's own alerts.usagePercent, not a fixed 85", () => {
    const { home, configDir } = setup();
    const guard = subprocessGuard();
    const now = Math.floor(Date.now() / 1000);
    mkdirSync(join(home, ".config", "cc-smart-dev-kit"), { recursive: true });
    writeFileSync(
      join(home, ".config", "cc-smart-dev-kit", "workflow.json"),
      `${JSON.stringify({ alerts: { usagePercent: 40 } })}\n`,
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
    expect(result.stdout.toString()).toStartWith("Opus 5.5 · ⚠ 5h 40% (resets ");
    expect(result.stderr.toString()).toBe("");
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
        "Auto mode's safety checks the router counted on this machine:",
        "  none in the last 8 days (the gateway must be set up, and a session must have run with auto mode on)",
        "",
      ].join("\n"),
    );
    expect(result.stdout).not.toContain("secret words");
    const wrong = run(["usage", "--days", "1"]);
    expect(wrong.exitCode).toBe(2);
    expect(wrong.stderr).toStartWith("Unknown option: --days");
  });

  test("usage --json is the same report as one object, each subagent's record included", () => {
    const { configDir, stateDir, run } = setup();
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
    // The subagent's own record, as `agent-usage` writes it at its stop (0.0149 USD by hand).
    const at = Date.now() - 60_000;
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(stateDir, "agent-usage.jsonl"),
      `${JSON.stringify({
        agent: "a1",
        agentType: "general-purpose",
        at,
        models: [
          {
            cacheRead: 2000,
            cacheWrite: 100,
            input: 1000,
            model: "claude-opus-5-5",
            output: 500,
            replies: 2,
            usd: 0.0149,
          },
        ],
        session: "session-1",
        unpriced: 0,
        usd: 0.0149,
      })}\n`,
    );
    const result = run(["usage", "--hours", "1", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("secret words");
    const report = JSON.parse(result.stdout);
    expect(report).toEqual({
      agents: [
        {
          agent: "a1",
          agentType: "general-purpose",
          at,
          cacheRead: 2000,
          cacheWrite: 100,
          input: 1000,
          models: [
            {
              cacheRead: 2000,
              cacheWrite: 100,
              input: 1000,
              model: "claude-opus-5-5",
              output: 500,
              replies: 2,
              usd: 0.0149,
            },
          ],
          output: 500,
          replies: 2,
          session: "session-1",
          unpriced: 0,
          usd: 0.0149,
        },
      ],
      format: 1,
      hours: 1,
      sessions: [
        {
          archived: false,
          cwd: "/home/user/my-app",
          launched: { sonnet: 1 },
          main: {},
          project: "-home-user-my-app",
          replies: { "glm-5.3-flash": 1 },
          session: "session-1",
          subagents: 1,
        },
      ],
      totals: {
        agentReplies: 2,
        agents: 1,
        agentTokens: { cacheRead: 2000, cacheWrite: 100, input: 1000, output: 500 },
        agentUnpriced: 0,
        agentUsd: 0.0149,
        main: {},
        replies: { "glm-5.3-flash": 1 },
        sessions: 1,
        subagents: 1,
      },
    });
  });

  test("usage shows the safety checks the router counted, today first", () => {
    const { home, run } = setup();
    // The router's file, as it writes it. Its days are calendar days in the machine's own
    // zone (proved in `src/gateway/safety-checks.test.ts`), so today's key comes from the
    // clock — and BOTH sides of this test pin the SAME zone: the CLI is started with
    // TZ=Etc/UTC below, and the key is computed in Etc/UTC here. Without that, the test
    // compares two different days for as long as the machine's zone is ahead of UTC (seen
    // on a machine at UTC+5 after midnight there).
    const file = join(home, ".local", "state", "cc-smart-dev-kit", "safety-checks.json");
    mkdirSync(dirname(file), { recursive: true });
    const today = localDay(Date.now(), "Etc/UTC");
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          days: {
            [today]: {
              anthropic: { cacheRead: 500, cacheWrite: 0, checks: 2, input: 1234, output: 7 },
              checks: 3,
              fallback: { cacheRead: 0, cacheWrite: 0, checks: 1, input: 11, output: 3 },
            },
          },
          version: 1,
        },
        null,
        2,
      )}\n`,
    );
    const result = run(["usage", "--hours", "1"], { TZ: "Etc/UTC" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n").slice(-4)).toEqual([
      "Auto mode's safety checks the router counted on this machine:",
      `  today (${today}): 3 checks — Anthropic 2 (1234 in, 7 out, 500 cache read, 0 cache write); your judge 1 (11 in, 3 out, 0 cache read, 0 cache write)`,
      "  The tokens are what each answer's `usage` reported; whether they count against a Pro, Max or Team plan's limit is not confirmed (Anthropic's docs say they do on Enterprise and API accounts).",
      "",
    ]);
  });
});

describe("D56: setup turns Claude Code's retry watchdog on by default", () => {
  const WATCHDOG = "CLAUDE_CODE_RETRY_WATCHDOG";
  const RECHECK = "CLAUDE_CODE_RETRY_WATCHDOG_USAGE_LIMIT_RECHECK_MS";
  const CAP = "CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS";
  /** The key setup writes beside them whenever claude-mem is installed (D23). */
  const TODO = { CLAUDE_CODE_ENABLE_TODO_TOOLS: "1" };
  const ON_LINE = `  ~ ~/.claude/settings.json: env.${WATCHDOG}: (none) -> "1"`;
  const RECHECK_LINE = `  ~ ~/.claude/settings.json: env.${RECHECK}: (none) -> "300000"`;
  const CAP_LINE = `  ~ ~/.claude/settings.json: env.${CAP}: (none) -> "86400000"`;
  const ALL_ON = { ...TODO, [WATCHDOG]: "1", [RECHECK]: "300000", [CAP]: "86400000" };
  const ON_NOTE =
    '  · retry watchdog: on, so every Claude session on this machine waits and retries at a limit instead of failing ("Retrying in …"; Esc cancels); a limit that resets more than 24 hours away ends the wait; a `claude -p` script can wait until a model answers; to turn it off: cc-smart-dev-kit setup --no-retry-watchdog\n';
  const DECLINED_NOTE =
    "  · retry watchdog: off because you said no; cc-smart-dev-kit setup --retry-watchdog turns it on\n";
  const DOCTOR_OFF =
    "· retry watchdog: off, so a session fails at a limit instead of waiting; to turn it on, run: cc-smart-dev-kit setup --retry-watchdog\n";

  /** The "no" a person gave before, as setup stores it. */
  function decline(stateDir: string): void {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(retryWatchdogDeclinedFile(stateDir), "no\n", { mode: 0o600 });
  }

  /**
   * What a setup before D56's cap left: the two keys, and `owned.json` saying setup wrote them.
   * The cap goes from both the settings and the record.
   */
  function asBeforeTheCap(stateDir: string, settingsFile: string): void {
    const settings = readJson(settingsFile);
    delete settings.env[CAP];
    writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
    const ownedFile = join(stateDir, "owned.json");
    const owned = readJson(ownedFile);
    for (const file of Object.keys(owned)) {
      owned[file] = owned[file].filter(
        (record: { path: string[] }) => record.path.join(".") !== `env.${CAP}`,
      );
    }
    writeFileSync(ownedFile, JSON.stringify(owned));
  }

  /** Terminal tests run setup in this process: silence its output, run `body`, put the output back. */
  async function quietly(body: () => Promise<void>): Promise<void> {
    const quiet = spyOn(console, "log").mockImplementation(() => undefined);
    const loud = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await body();
    } finally {
      quiet.mockRestore();
      loud.mockRestore();
    }
  }

  /** Writes `env` into the settings, as a person would by hand. */
  function setEnv(settingsFile: string, env: Record<string, string>): void {
    writeFileSync(settingsFile, JSON.stringify({ ...readJson(settingsFile), env }));
  }

  test("a plain run turns it on: exactly the three keys, with the 24-hour cap, and one · line says what it means", () => {
    const { settingsFile, stateDir, run } = setup();
    const real = run(["setup"]);
    expect(real.exitCode).toBe(0);
    expect(real.stdout).toContain(`${ON_LINE}\n${RECHECK_LINE}\n${CAP_LINE}\n`);
    expect(real.stdout).toContain(ON_NOTE);
    // Exactly the watchdog keys: no `..._MAX_WAIT_MS`, which the 5-hour limit and a down
    // model still wait out with no limit.
    expect(readJson(settingsFile).env).toEqual(ALL_ON);
    expect(Object.keys(readJson(settingsFile).env).sort()).toEqual(
      ["CLAUDE_CODE_ENABLE_TODO_TOOLS", WATCHDOG, RECHECK, CAP].sort(),
    );
    // restore removes all three, and the `env` setup made goes with them.
    expect(readJson(settingsFile)).toHaveProperty("env");
    restore(stateDir);
    expect(readJson(settingsFile)).not.toHaveProperty("env");
  });

  test("a no on file: nothing changes, one · line says why; the flag turns it on and forgets the no", () => {
    const { settingsFile, stateDir, run } = setup();
    decline(stateDir);
    const real = run(["setup"]);
    expect(real.exitCode).toBe(0);
    expect(real.stdout).toContain(DECLINED_NOTE);
    expect(real.stdout).not.toContain(WATCHDOG);
    expect(readJson(settingsFile).env).toEqual(TODO);
    // A dry run says the same · line, and the "no" stays.
    const dry = run(["setup", "--dry-run"]);
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toContain(DECLINED_NOTE);
    expect(readJson(settingsFile).env).toEqual(TODO);
    expect(existsSync(retryWatchdogDeclinedFile(stateDir))).toBe(true);
    // --retry-watchdog writes all three keys and removes the "no", so the state agrees.
    const on = run(["setup", "--retry-watchdog"]);
    expect(on.exitCode).toBe(0);
    expect(on.stdout).toContain(`${ON_LINE}\n${RECHECK_LINE}\n${CAP_LINE}\n`);
    expect(on.stdout).toContain(ON_NOTE);
    expect(on.stdout).not.toContain(DECLINED_NOTE);
    expect(readJson(settingsFile).env).toEqual(ALL_ON);
    expect(existsSync(retryWatchdogDeclinedFile(stateDir))).toBe(false);
  });

  test("with no terminal, and with --yes: a dry run names the three changes and writes nothing", () => {
    const { settingsFile, stateDir, run } = setup();
    const before = readFileSync(settingsFile, "utf8");
    const dry = run(["setup", "--dry-run"]);
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toContain(`${ON_LINE}\n${RECHECK_LINE}\n${CAP_LINE}\n`);
    expect(dry.stdout).toContain(ON_NOTE);
    expect(dry.stdout).toContain("Dry run: nothing was written or run.");
    expect(readFileSync(settingsFile, "utf8")).toBe(before);
    // --yes changes nothing here: there is no question to skip any more.
    const dryYes = run(["setup", "--dry-run", "--yes"]);
    expect(dryYes.stdout).toContain(`${ON_LINE}\n${RECHECK_LINE}\n${CAP_LINE}\n`);
    expect(readFileSync(settingsFile, "utf8")).toBe(before);
    const real = run(["setup", "--yes"]);
    expect(real.exitCode).toBe(0);
    expect(real.stdout).toContain(ON_NOTE);
    expect(readJson(settingsFile).env).toEqual(ALL_ON);
    expect(existsSync(retryWatchdogDeclinedFile(stateDir))).toBe(false);
  });

  test("a dry run on a terminal asks nothing, writes nothing, and names the three changes", async () => {
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });
    try {
      const { home, configDir, stateDir, settingsFile } = setup();
      const paths = cliPaths({ CLAUDE_CONFIG_DIR: configDir, HOME: home });
      const before = readFileSync(settingsFile, "utf8");
      const asked: string[] = [];
      const say = (question: string) => {
        asked.push(question);
        return true;
      };
      expect(await runSetup(paths, setupOptions(home, say, { dryRun: true }))).toBe(0);
      expect(asked).toEqual([]);
      expect(lines.join("\n")).toContain(`${ON_LINE}\n${RECHECK_LINE}\n${CAP_LINE}\n`);
      expect(lines.join("\n")).toContain(ON_NOTE);
      expect(readFileSync(settingsFile, "utf8")).toBe(before);
      expect(existsSync(retryWatchdogDeclinedFile(stateDir))).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  test("--retry-watchdog: a dry run names all three changes, a real run writes them, a second run changes nothing", () => {
    const { settingsFile, run } = setup();
    const before = readFileSync(settingsFile, "utf8");
    const dry = run(["setup", "--dry-run", "--retry-watchdog"]);
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toContain(`${ON_LINE}\n${RECHECK_LINE}\n${CAP_LINE}\n`);
    expect(dry.stdout).toContain(ON_NOTE);
    expect(readFileSync(settingsFile, "utf8")).toBe(before);

    const real = run(["setup", "--retry-watchdog"]);
    expect(real.stderr).toBe("");
    expect(real.exitCode).toBe(0);
    expect(real.stdout).toContain(`${ON_LINE}\n${RECHECK_LINE}\n${CAP_LINE}\n`);
    expect(readJson(settingsFile).env).toEqual(ALL_ON);
    // Again: nothing to change.
    expect(run(["setup", "--retry-watchdog"]).stdout).toBe(NOTHING_TO_CHANGE);
    expect(run(["setup"]).stdout).toBe(NOTHING_TO_CHANGE);
  });

  test("an older setup's two keys: the next run adds the cap, one change line and no · line", () => {
    const { stateDir, settingsFile, run } = setup();
    expect(run(["setup"]).exitCode).toBe(0);
    asBeforeTheCap(stateDir, settingsFile);

    const after = run(["setup"]);
    expect(after.exitCode).toBe(0);
    expect(after.stdout).toBe(
      setupStdout(
        SETUP_HEADING,
        ["✓ Claude Code settings  1 change", CAP_LINE, ...MCP_TAVILY_ONLY],
        [`! Done: 1 change, with 1 warning to read above. ${BACKUPS}`],
        [RESTART_STEP],
      ),
    );
    expect(readJson(settingsFile).env).toEqual(ALL_ON);
  });

  test("a stale no beside our keys: a plain run completes the cap, forgets the no, and does not say off", () => {
    const { stateDir, settingsFile, run } = setup();
    // `--retry-watchdog` in 1.0.x–1.1.0 wrote the two keys but never removed an earlier "no".
    expect(run(["setup", "--retry-watchdog"]).exitCode).toBe(0);
    asBeforeTheCap(stateDir, settingsFile);
    decline(stateDir);

    const after = run(["setup"]);
    expect(after.exitCode).toBe(0);
    expect(after.stdout).toContain(CAP_LINE);
    expect(after.stdout).not.toContain(DECLINED_NOTE);
    expect(existsSync(retryWatchdogDeclinedFile(stateDir))).toBe(false);
    expect(readJson(settingsFile).env).toEqual(ALL_ON);
    // The keys and the "no" now agree: a later dry run has nothing to say about the watchdog.
    expect(run(["setup", "--dry-run"]).stdout).not.toContain("retry watchdog");
  });

  test("a key the person deleted after setup wrote it is not put back", () => {
    const { settingsFile, run } = setup();
    expect(run(["setup"]).exitCode).toBe(0);
    const settings = readJson(settingsFile);
    delete settings.env[WATCHDOG];
    writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);

    const after = run(["setup"]);
    expect(after.exitCode).toBe(0);
    expect(after.stdout).not.toContain("retry watchdog");
    // The two keys setup still owns stay; the one they removed is theirs.
    expect(readJson(settingsFile).env).toEqual({
      ...TODO,
      [RECHECK]: "300000",
      [CAP]: "86400000",
    });
  });

  test("on a terminal, a plain setup asks nothing about the watchdog and turns it on", async () => {
    await quietly(async () => {
      const { home, configDir, settingsFile } = setup();
      const paths = cliPaths({ CLAUDE_CONFIG_DIR: configDir, HOME: home });
      const asked: string[] = [];
      const say = (question: string) => {
        asked.push(question);
        return true;
      };
      // Exit 1: this world has no `claude` on PATH, so the MCP servers are skipped and named.
      expect(await runSetup(paths, setupOptions(home, say))).toBe(1);
      // The status line's question is the only one: no watchdog question exists any more.
      expect(asked).toHaveLength(1);
      expect(asked[0]).toStartWith("Show cc-smart-dev-kit's status line");
      expect(readJson(settingsFile).env).toEqual(ALL_ON);
    });
  });

  test("with the flag, a terminal is not asked about the watchdog either", async () => {
    await quietly(async () => {
      const { home, configDir, settingsFile } = setup();
      const paths = cliPaths({ CLAUDE_CONFIG_DIR: configDir, HOME: home });
      const asked: string[] = [];
      const say = (question: string) => {
        asked.push(question);
        return false;
      };
      expect(await runSetup(paths, setupOptions(home, say, { retryWatchdog: true }))).toBe(1);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toStartWith("Show cc-smart-dev-kit's status line");
      expect(readJson(settingsFile).env).toEqual(ALL_ON);
    });
  });

  test("a value the person set is left alone: not named, not asked; the flag stops on a different one", async () => {
    const { home, configDir, settingsFile, run } = setup();
    // A different value of their own: a terminal is asked about the status line only.
    setEnv(settingsFile, { [WATCHDOG]: "0" });
    await quietly(async () => {
      const paths = cliPaths({ CLAUDE_CONFIG_DIR: configDir, HOME: home });
      const asked: string[] = [];
      const say = (question: string) => {
        asked.push(question);
        return true;
      };
      expect(await runSetup(paths, setupOptions(home, say))).toBe(1);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toStartWith("Show cc-smart-dev-kit's status line");
    });
    expect(readJson(settingsFile).env).toEqual({ ...TODO, [WATCHDOG]: "0" });
    // The flag may not overwrite it: setup stops, and writes nothing.
    const refused = run(["setup", "--retry-watchdog"]);
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain(`env.${WATCHDOG} is "0", set by someone else`);
    expect(readJson(settingsFile).env).toEqual({ ...TODO, [WATCHDOG]: "0" });
    // The same value, set by hand: left alone and named, and the other keys are ours.
    setEnv(settingsFile, { [WATCHDOG]: "1" });
    const same = run(["setup", "--retry-watchdog"]);
    expect(same.exitCode).toBe(0);
    expect(same.stdout).toContain(
      `  · ~/.claude/settings.json: env.${WATCHDOG}: already set by someone else; left alone\n`,
    );
    expect(same.stdout).toContain(RECHECK_LINE);
    expect(same.stdout).toContain(CAP_LINE);
    expect(readJson(settingsFile).env).toEqual(ALL_ON);
    // restore takes out only the keys that are ours.
    expect(run(["restore", "--yes"]).exitCode).toBe(0);
    expect(readJson(settingsFile).env).toEqual({ [WATCHDOG]: "1" });
  });

  test("a plain run leaves a value of the person's own alone, whether it turns the watchdog on or off", () => {
    for (const value of ["on", "0"]) {
      const { settingsFile, run } = setup();
      setEnv(settingsFile, { [WATCHDOG]: value });
      const real = run(["setup"]);
      expect(real.exitCode).toBe(0);
      expect(real.stdout).not.toContain("retry watchdog");
      // No cap beside their watchdog: their watchdog, their limits.
      expect(real.stdout).not.toContain(CAP);
      expect(readJson(settingsFile).env).toEqual({ ...TODO, [WATCHDOG]: value });
    }
  });

  test("a no on file beside the person's own key: no false off line", () => {
    const { settingsFile, stateDir, run } = setup();
    decline(stateDir);
    setEnv(settingsFile, { [WATCHDOG]: "1" });

    const real = run(["setup"]);
    expect(real.exitCode).toBe(0);
    expect(real.stdout).not.toContain(DECLINED_NOTE);
    expect(real.stdout).not.toContain("retry watchdog");
    expect(readJson(settingsFile).env).toEqual({ ...TODO, [WATCHDOG]: "1" });
    // The "no" stays theirs: nothing of ours was turned on, so nothing forgot it.
    expect(existsSync(retryWatchdogDeclinedFile(stateDir))).toBe(true);
  });

  test("restore removes all three keys; a value the person changed since stays", () => {
    const { settingsFile, run } = setup();
    expect(run(["setup", "--retry-watchdog"]).exitCode).toBe(0);
    setEnv(settingsFile, { [WATCHDOG]: "1", [RECHECK]: "60000", [CAP]: "86400000" });
    expect(run(["restore", "--yes"]).exitCode).toBe(0);
    expect(readJson(settingsFile).env).toEqual({ [RECHECK]: "60000" });
    expect(run(["setup", "--retry-watchdog"]).exitCode).toBe(1);
  });

  test("--no-retry-watchdog takes ours out, remembers the no, and a later plain setup leaves it off", () => {
    const { settingsFile, stateDir, run } = setup();
    expect(run(["setup"]).exitCode).toBe(0);
    const off = run(["setup", "--no-retry-watchdog"]);
    expect(off.exitCode).toBe(0);
    expect(off.stdout).toContain(`~ ~/.claude/settings.json: env.${WATCHDOG}: "1" -> (none)\n`);
    expect(off.stdout).toContain(`~ ~/.claude/settings.json: env.${RECHECK}: "300000" -> (none)\n`);
    expect(off.stdout).toContain(`~ ~/.claude/settings.json: env.${CAP}: "86400000" -> (none)\n`);
    expect(readJson(settingsFile).env).toEqual(TODO);
    expect(readFileSync(retryWatchdogDeclinedFile(stateDir), "utf8")).toBe("no\n");
    // The "no" holds for a plain setup, which says so in one · line.
    const again = run(["setup"]);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain(DECLINED_NOTE);
    expect(readJson(settingsFile).env).toEqual(TODO);
    // A key the person wrote is not named, not touched.
    decline(stateDir);
    setEnv(settingsFile, { [WATCHDOG]: "1" });
    const own = run(["setup", "--no-retry-watchdog"]);
    expect(own.exitCode).toBe(0);
    expect(own.stdout).not.toContain(WATCHDOG);
    expect(readJson(settingsFile).env).toEqual({ ...TODO, [WATCHDOG]: "1" });
  });

  test("restore removes all three keys; a later setup turns it on again unless a no is on file", () => {
    const { settingsFile, stateDir, run } = setup();
    expect(run(["setup"]).exitCode).toBe(0);
    expect(run(["restore", "--yes"]).exitCode).toBe(0);
    // The `env` setup made goes with its last key.
    expect(readJson(settingsFile)).not.toHaveProperty("env");
    // No "no": the next plain setup turns it on again.
    expect(run(["setup"]).exitCode).toBe(0);
    expect(readJson(settingsFile).env).toEqual(ALL_ON);
    // With a "no" on file, the same restore-then-setup leaves it off.
    expect(run(["restore", "--yes"]).exitCode).toBe(0);
    decline(stateDir);
    expect(run(["setup"]).exitCode).toBe(0);
    expect(readJson(settingsFile).env).toEqual(TODO);
  });

  test("our keys already there: nothing to change, and no · line", () => {
    const { run } = setup();
    expect(run(["setup"]).exitCode).toBe(0);
    expect(run(["setup"]).stdout).toBe(NOTHING_TO_CHANGE);
    expect(run(["setup", "--dry-run"]).stdout).not.toContain("retry watchdog");
  });

  test("both flags at once are a usage error", () => {
    const { settingsFile, run } = setup();
    const before = readFileSync(settingsFile, "utf8");
    const result = run(["setup", "--retry-watchdog", "--no-retry-watchdog"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Use --retry-watchdog or --no-retry-watchdog, not both.");
    expect(readFileSync(settingsFile, "utf8")).toBe(before);
  });

  test("doctor: off, on by setup, on by the person, off by the person: one · line each, never a failure", () => {
    const { settingsFile, run } = setup();
    const line = (stdout: string) => doctorLines(stdout, (text) => text.includes("retry watchdog"));
    expect(run(["doctor", "--verbose"]).stdout).toContain(DOCTOR_OFF);
    expect(line(run(["doctor", "--verbose"]).stdout)).toEqual([DOCTOR_OFF.trimEnd()]);

    expect(run(["setup", "--retry-watchdog"]).exitCode).toBe(0);
    expect(line(run(["doctor", "--verbose"]).stdout)).toEqual([
      "· retry watchdog: on (set by cc-smart-dev-kit): a session waits and retries at a limit; turn it off with: cc-smart-dev-kit setup --no-retry-watchdog",
    ]);

    expect(run(["restore", "--yes"]).exitCode).toBe(0);
    setEnv(settingsFile, { [WATCHDOG]: "1" });
    expect(line(run(["doctor", "--verbose"]).stdout)).toEqual([
      `· retry watchdog: on (your own ${WATCHDOG} in ~/.claude/settings.json)`,
    ]);

    setEnv(settingsFile, { [WATCHDOG]: "0" });
    expect(line(run(["doctor", "--verbose"]).stdout)).toEqual([
      `· retry watchdog: off (your own ${WATCHDOG} in ~/.claude/settings.json leaves it off; change it by hand to turn it on)`,
    ]);
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
    ]);
    expect(userConfig.mcpServers.playwright).toEqual({
      args: ["browser", "mcp"],
      command: join(home, ".local", "bin", "cc-smart-dev-kit"),
    });

    // doctor: each one is registered and starts (the fake `claude mcp get` says Connected).
    const checked = run(["doctor", "--verbose"]);
    expect(checked.stdout).toContain('✓ MCP server "playwright": Connected\n');
    expect(checked.stdout).toContain('✓ MCP server "sequential-thinking": Connected\n');

    // restore: removed from Claude Code's config, and no record left.
    const restored = run(["restore"]);
    expect(restored.exitCode).toBe(0);
    expect(restored.stdout).toContain("- MCP server playwright removed from your user config\n");
    expect(readJson(join(configDir, ".claude.json")).mcpServers).toEqual({});
    expect(existsSync(join(configDir, "cc-smart-dev-kit", "mcp-servers.json"))).toBe(false);
  });

  test("Serena, as an older setup left it: setup takes back its own registration, the context and the records; doctor says so once", () => {
    const { configDir, home, stateDir, run, claudeCalls } = setup();
    expect(run(["setup"]).exitCode).toBe(0);
    // What an older setup left: `serena` registered and recorded, its context file as a
    // tracked whole file, and the serena-root hook's records.
    const where = serenaLeftoverPaths(cliPaths({ CLAUDE_CONFIG_DIR: configDir, HOME: home }));
    const serenaJson = JSON.stringify({
      args: ["serena", "start-mcp-server", "--context", where.contextFile],
      command: "uvx",
    });
    const userConfigFile = join(configDir, ".claude.json");
    const userConfig = readJson(userConfigFile);
    userConfig.mcpServers.serena = JSON.parse(serenaJson);
    writeFileSync(userConfigFile, JSON.stringify(userConfig, null, 2));
    recordMcpServer(stateDir, "serena", serenaJson, "2026-10-01T00:00:00.000Z");
    writeManagedFile(where.contextFile, "single_project: false\n", {
      kind: "whole-file",
      newFileMode: 0o644,
      stateDir,
    });
    mkdirSync(where.recordDir, { recursive: true });
    writeFileSync(join(where.recordDir, "11111111-2222-3333-4444-555555555555.txt"), "unknown");

    const owed =
      '✗ Serena is retired in 0.6.0, and setup has not taken back the "serena" MCP server it registered, Serena\'s context ~/.local/share/cc-smart-dev-kit/serena/contexts/worktree.yml, the serena-root records in ~/.claude/cc-smart-dev-kit/serena-root/ yet\n    Fix: cc-smart-dev-kit setup\n';
    const before = run(["doctor", "--verbose"]);
    expect(before.exitCode).toBe(1);
    expect(before.stdout).toContain(owed);

    const removed = [
      "  - ~/.local/share/cc-smart-dev-kit/serena/contexts/worktree.yml: removed (Serena's context; Serena is retired in 0.6.0)",
      "  - ~/.local/share/cc-smart-dev-kit/serena/: removed (Serena's folder, empty now)",
      "  - ~/.claude/cc-smart-dev-kit/serena-root/: removed (the serena-root hook's records; Serena is retired in 0.6.0)",
    ];
    // A dry run shows each step, and changes nothing.
    const dry = run(["setup", "--dry-run"]);
    expect(dry.exitCode).toBe(0);
    expect(dry.stdout).toBe(
      setupStdout(
        SETUP_DRY_HEADING,
        [
          "! MCP servers           4 to change, 1 warning",
          "  $ claude mcp remove serena --scope user",
          ...removed,
          TAVILY_SKIPPED,
        ],
        ["· A real run makes 4 changes.", "Dry run: nothing was written or run."],
      ),
    );
    expect(readJson(userConfigFile).mcpServers.serena).toBeDefined();
    expect(existsSync(where.contextFile)).toBe(true);
    expect(existsSync(where.recordDir)).toBe(true);
    expect(claudeCalls()).not.toContain("mcp remove serena");

    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      setupStdout(
        SETUP_HEADING,
        [
          "! MCP servers           4 changes, 1 warning",
          "  - MCP server serena removed from your user config",
          ...removed,
          TAVILY_SKIPPED,
        ],
        [`! Done: 4 changes, with 1 warning to read above. ${BACKUPS}`],
        [RESTART_STEP],
      ),
    );
    // Through Claude Code's own command; the plugin's own servers stay.
    expect(claudeCalls()).toContain("mcp remove serena --scope user\n");
    expect(Object.keys(readJson(userConfigFile).mcpServers).sort()).toEqual([
      "playwright",
      "sequential-thinking",
    ]);
    expect(existsSync(where.folder)).toBe(false);
    expect(existsSync(where.recordDir)).toBe(false);
    expect(listBackups(stateDir, where.contextFile).at(-1)?.absent).toBe(false);

    // doctor has nothing more to say about it, and a second setup has nothing to do.
    const after = run(["doctor", "--verbose"]);
    expect(after.stdout).not.toContain("Serena");
    expect(after.stdout).not.toContain("serena");
    expect(run(["setup"]).stdout).toBe(NOTHING_TO_CHANGE);
  });

  test("a serena of the person's own: setup never touches it, and doctor shows it with ·, never ✗", () => {
    const { configDir, run, claudeCalls } = setup();
    expect(run(["setup"]).exitCode).toBe(0);
    const userConfigFile = join(configDir, ".claude.json");
    const userConfig = readJson(userConfigFile);
    userConfig.mcpServers.serena = { args: ["serena", "start-mcp-server"], command: "uvx" };
    writeFileSync(userConfigFile, JSON.stringify(userConfig, null, 2));

    expect(run(["setup"]).stdout).toBe(NOTHING_TO_CHANGE);
    expect(claudeCalls()).not.toContain("mcp remove serena");
    expect(readJson(userConfigFile).mcpServers.serena).toEqual({
      args: ["serena", "start-mcp-server"],
      command: "uvx",
    });
    const checked = run(["doctor", "--verbose"]);
    expect(checked.stdout).toContain(
      '· the "serena" MCP server is registered (uvx serena start-mcp-server), and cc-smart-dev-kit has no record of registering it as it is: cc-smart-dev-kit no longer registers it (0.6.0) and leaves it alone. To remove it: claude mcp remove serena --scope user\n',
    );
    expect(checked.stdout).not.toContain("✗ Serena");
  });

  test("a bunx on PATH: sequential-thinking is registered by its absolute path", () => {
    // Claude Code may be started with a PATH that has no bun (the reason the launcher and
    // the hooks' shim find bun themselves): a bare `bunx` would not start there. The
    // machine's own `bunx`, as setup found it, is what the registration names.
    const { bunBin, run, claudeCalls } = setup();
    const bunx = join(bunBin, "bunx");
    writeFileSync(bunx, "#!/bin/sh\nexit 0\n");
    chmodSync(bunx, 0o755);
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(claudeCalls()).toContain(
      `mcp add-json --scope user sequential-thinking {"args":["-y","@modelcontextprotocol/server-sequential-thinking@${MCP_VERSIONS.sequentialThinking}"],"command":"${bunx}"}`,
    );
  });

  test("no bunx on the machine: sequential-thinking keeps the bare name", () => {
    // Nothing to point at: the registration says `bunx`, and Claude Code's own PATH decides.
    const { run, claudeCalls } = setup();
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(claudeCalls()).toContain(
      `mcp add-json --scope user sequential-thinking {"args":["-y","@modelcontextprotocol/server-sequential-thinking@${MCP_VERSIONS.sequentialThinking}"],"command":"bunx"}`,
    );
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
    const checked = run(["doctor", "--verbose"]);
    expect(checked.stdout).toContain('✓ MCP server "tavily-websearch": Connected\n');
    expect(checked.stdout).not.toContain("tvly-file-secret");
    // restore removes it again, and never prints it either.
    const restored = run(["restore"]);
    expect(restored.exitCode).toBe(0);
    expect(`${restored.stdout}${restored.stderr}`).not.toContain("tvly-file-secret");
    // The line names the key's PATH, never its value. The `env` object setup made for it goes
    // with the key: this settings file had none of its own.
    expect(restored.stdout).toContain(
      "env.TAVILY_API_KEY, env.CLAUDE_CODE_ENABLE_TODO_TOOLS, env, the hook entry in hooks.Notification; everything else kept",
    );
    expect(readJson(join(home, ".claude", "settings.json")).env).toBeUndefined();
  });

  test("a Tavily key that lives only in the settings stays there (M2, premium review)", () => {
    // Claude Code expands `Bearer ${TAVILY_API_KEY}` from the settings' `env` as well as from
    // the environment, so a key that is only there is a working Tavily. The risky shape is one
    // SETUP wrote (an owned secret) whose key file is then gone: reading it as "no key" removed
    // the settings copy and unregistered the server, while the person's Claude Code still had a
    // working Tavily. It is kept now, and nothing about it is printed.
    const { configDir, home, run } = setup();
    const settingsFile = join(home, ".claude", "settings.json");
    const keyFile = join(configDir, "cc-smart-dev-kit", "tavily.key");
    expect(run(["setup", "--tavily-key-stdin"], {}, home, "tvly-from-file\n").exitCode).toBe(0);
    expect(readJson(settingsFile).env.TAVILY_API_KEY).toBe("tvly-from-file");
    expect(readJson(join(configDir, ".claude.json")).mcpServers["tavily-websearch"]).toBeDefined();

    // The key file goes: the only copy left is the one in the settings.
    rmSync(keyFile);
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(readJson(settingsFile).env.TAVILY_API_KEY).toBe("tvly-from-file");
    expect(`${result.stdout}${result.stderr}`).not.toContain("tvly-from-file");
    expect(result.stdout).not.toContain("env.TAVILY_API_KEY");
    // And the server stays registered: the plugin still has a key for it.
    expect(readJson(join(configDir, ".claude.json")).mcpServers["tavily-websearch"]).toBeDefined();
  });

  test("a Tavily key on stdin: the key file 0600, an owned secret, never printed", () => {
    const { configDir, home, run } = setup();
    const keyFile = join(configDir, "cc-smart-dev-kit", "tavily.key");
    // The key arrives on stdin (the installer's way in): `--tavily-key-stdin`, never an
    // argument, which the process list and the shell's history would show.
    const result = run(["setup", "--tavily-key-stdin"], {}, home, "tvly-stdin-secret\n");
    expect(result.exitCode).toBe(0);
    // It is written to the key file a person may write by hand — the one home of that key —
    // mode 600, and the settings get the owned secret as they do for a key file.
    expect(readFileSync(keyFile, "utf8")).toBe("tvly-stdin-secret\n");
    expect(statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(readJson(join(home, ".claude", "settings.json")).env.TAVILY_API_KEY).toBe(
      "tvly-stdin-secret",
    );
    // The line names the file, never the value.
    expect(result.stdout).toContain(
      "+ ~/.claude/cc-smart-dev-kit/tavily.key: the Tavily key (a secret, mode 600)",
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain("tvly-stdin-secret");
    // A later plain setup keeps it: the key file is where the key comes from now.
    const again = run(["setup"]);
    expect(again.exitCode).toBe(0);
    expect(readJson(join(home, ".claude", "settings.json")).env.TAVILY_API_KEY).toBe(
      "tvly-stdin-secret",
    );
    expect(`${again.stdout}${again.stderr}`).not.toContain("tvly-stdin-secret");
    // An empty stdin is refused as a usage mistake: the option was given with nothing to
    // read, so exit 2 and the one line that says which help explains it.
    const empty = run(["setup", "--tavily-key-stdin"], {}, home, "");
    expect(empty.exitCode).toBe(2);
    expect(empty.stderr).toBe(`No key arrived on stdin\nSee: ${COMMAND} setup --help\n`);
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

    // The key file goes, and neither the environment nor the settings have one any more
    // (setup's own settings copy is removed by hand here, which is what "no key at all"
    // means: the settings' `env` is a place Claude Code really reads the key from): the
    // server goes back, and so does the copy of the key in the settings.
    rmSync(keyFile);
    const settingsFile = join(home, ".claude", "settings.json");
    const settings = readJson(settingsFile) as { env?: Record<string, unknown> };
    if (settings.env !== undefined) delete settings.env.TAVILY_API_KEY;
    writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
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
    const checked = run(["doctor", "--verbose"]);
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

describe("cc-smart-dev-kit on Windows: the launcher, Git Bash, and what doctor says", () => {
  /**
   * The host facts a Windows machine gives the CLI: the same shape as the Linux ones above,
   * with `platform: "win32"`. The platform decides the launcher's `.cmd` twin, doctor's Git
   * Bash check and the PATH note — everything else is the same temp home.
   */
  function windowsHost(extra: Record<string, string> = {}): Record<string, string> {
    return {
      [TEST_HOST_VAR]: JSON.stringify({
        platform: "win32",
        arch: "x64",
        osRelease: null,
        macApp: "C:\\no-such-Warp.app",
      }),
      ...extra,
    };
  }

  test("setup writes the .cmd twin beside the sh launcher, as one managed file", () => {
    const { binDir, run } = setup();
    const result = run(["setup"], windowsHost());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("+ ~/.local/bin/cc-smart-dev-kit: launcher created");
    expect(result.stdout).toContain("+ ~/.local/bin/cc-smart-dev-kit.cmd: launcher created");
    const cmd = join(binDir, "cc-smart-dev-kit.cmd");
    expect(existsSync(cmd)).toBe(true);
    // It bakes the bun that ran setup, and runs the installed cli.js.
    expect(readFileSync(cmd, "utf8")).toContain(`set "baked_bun=${process.execPath}"`);
    // A second setup changes nothing.
    expect(run(["setup"], windowsHost()).stdout).toContain(`\n${UP_TO_DATE}\n`);
  });

  test("off Windows setup writes no .cmd, and Linux output is untouched", () => {
    const { binDir, run } = setup();
    const result = run(["setup"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("cc-smart-dev-kit.cmd");
    expect(existsSync(join(binDir, "cc-smart-dev-kit.cmd"))).toBe(false);
  });

  test("restore removes the .cmd too", () => {
    const { binDir, run } = setup();
    run(["setup"], windowsHost());
    const cmd = join(binDir, "cc-smart-dev-kit.cmd");
    expect(existsSync(cmd)).toBe(true);
    const result = run(["restore"]);
    expect(result.stdout).toContain(
      "- ~/.local/bin/cc-smart-dev-kit.cmd: removed (cc-smart-dev-kit had created it)",
    );
    expect(existsSync(cmd)).toBe(false);
    expect(existsSync(join(binDir, "cc-smart-dev-kit"))).toBe(false);
  });

  test("the PATH step names the Windows folder and where to add it, first of the next steps", () => {
    const { binDir, fakeBin, run } = setup();
    // A PATH without the launcher's folder: what a fresh Windows machine has.
    const result = run(["setup"], windowsHost({ PATH: fakeBin }));
    expect(existsSync(join(binDir, "cc-smart-dev-kit.cmd"))).toBe(true);
    expect(result.stdout).toContain(
      `\nNext steps:\n  1. Add ${binDir} to your PATH, so the cc-smart-dev-kit command works: Windows Settings → System → About → Advanced system settings → Environment Variables → Path for your account. Then open a new terminal.\n`,
    );
  });

  test("doctor on Windows: no Git Bash and no .cmd are ✗, each saying what to run", () => {
    const { binDir, run } = setup();
    run(["setup"], windowsHost());
    // The .cmd is gone (a person removed it, or an older setup never wrote one).
    rmSync(join(binDir, "cc-smart-dev-kit.cmd"));
    const result = run(["doctor", "--verbose"], windowsHost());
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "✗ no Windows launcher at ~/.local/bin/cc-smart-dev-kit.cmd, so cmd and PowerShell cannot run cc-smart-dev-kit (Git Bash runs ~/.local/bin/cc-smart-dev-kit)\n    Fix: cc-smart-dev-kit setup",
    );
    // The sh launcher is still checked, and is in place: Git Bash runs it.
    expect(result.stdout).toContain(
      "✓ the launcher ~/.local/bin/cc-smart-dev-kit is in place (Git Bash runs it)",
    );
    expect(result.stdout).toContain("✗ Git Bash was not found");
    expect(result.stdout).toContain(
      "    Fix: install Git for Windows (https://git-scm.com/download/win), or set CLAUDE_CODE_GIT_BASH_PATH to bash.exe, then run: cc-smart-dev-kit doctor\n",
    );
    // The Linux-only parts are information, never a failure.
    expect(result.stdout).toContain(
      "· tmux: not on Windows, so no passthrough line is managed there",
    );
  });

  test("doctor on Windows with no launcher at all names the sh one first", () => {
    const { run } = setup();
    const result = run(["doctor", "--verbose"], windowsHost());
    expect(result.stdout).toContain(
      "✗ no launcher at ~/.local/bin/cc-smart-dev-kit\n    Fix: cc-smart-dev-kit setup",
    );
  });

  test("doctor on Windows: a .cmd baked with a bun that is gone is ✗ with the setup command", () => {
    const { binDir, stateDir, run } = setup();
    run(["setup"], windowsHost());
    const gone = join(tempDir("gone"), "bun.exe");
    installLauncherCmd(binDir, { stateDir, bunPath: gone });
    const result = run(["doctor", "--verbose"], windowsHost());
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      `✗ the Windows launcher's bun ${gone} is missing or not executable\n    Fix: cc-smart-dev-kit setup`,
    );
  });

  test("doctor on Windows asks whether the bun is there, not whether it has an execute bit", () => {
    const { binDir, stateDir, run } = setup();
    run(["setup"], windowsHost());
    // A bun with no execute bit. On Windows a mode means nothing — an `.exe` runs by being
    // there — so this is a working bun there and the launchers are fine. (The same file
    // would be "not executable" on Linux, which is the check that must not run on Windows.)
    const bun = join(tempDir("bun"), "bun.exe");
    writeFileSync(bun, "not really bun\n", { mode: 0o600 });
    installLauncher(binDir, { stateDir, bunPath: bun });
    installLauncherCmd(binDir, { stateDir, bunPath: bun });
    chmodSync(join(binDir, "cc-smart-dev-kit"), 0o755);
    const result = run(["doctor", "--verbose"], windowsHost());
    expect(result.stdout).toContain(
      "✓ the launcher ~/.local/bin/cc-smart-dev-kit is in place (Git Bash runs it)",
    );
    expect(result.stdout).not.toContain("missing or not executable");
  });

  test("doctor on Windows after setup: the .cmd runs through cmd.exe, Git Bash found by the variable", () => {
    const { fakeBin, run } = setup();
    // A fake `cmd.exe`, so the launcher's run is exercised without a Windows machine. It
    // logs its arguments, which is what proves doctor starts the .cmd through cmd.exe.
    const log = join(fakeBin, "cmd-calls.log");
    const fakeCmd = join(fakeBin, "cmd.exe");
    writeFileSync(fakeCmd, `#!/bin/sh\necho "$*" >> ${JSON.stringify(log)}\necho ${VERSION}\n`);
    chmodSync(fakeCmd, 0o755);
    // Git Bash where CLAUDE_CODE_GIT_BASH_PATH says it is (Claude Code accepts bash.exe).
    const bash = join(fakeBin, "bash.exe");
    writeFileSync(bash, "#!/bin/sh\nexit 0\n");
    chmodSync(bash, 0o755);

    run(["setup"], windowsHost());
    const result = run(["doctor", "--verbose"], windowsHost({ CLAUDE_CODE_GIT_BASH_PATH: bash }));
    expect(result.stdout).toContain(
      "✓ the launcher ~/.local/bin/cc-smart-dev-kit is in place (Git Bash runs it)",
    );
    expect(result.stdout).toContain(
      `✓ the Windows launcher ~/.local/bin/cc-smart-dev-kit.cmd runs ${VERSION}`,
    );
    expect(result.stdout).toContain(
      `✓ Git Bash is at ${bash}, which the hooks and the Bash tool run through`,
    );
    expect(readFileSync(log, "utf8")).toContain("cc-smart-dev-kit.cmd version");
  });

  test("doctor off Windows knows nothing of Git Bash or a .cmd", () => {
    const { run } = setup();
    run(["setup"]);
    const result = run(["doctor", "--verbose"]);
    expect(result.stdout).not.toContain("Git Bash");
    expect(result.stdout).not.toContain(".cmd");
    expect(result.stdout).not.toContain("tmux: not on Windows");
  });
});
