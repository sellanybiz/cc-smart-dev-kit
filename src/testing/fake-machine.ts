/**
 * A temp home right after `claude plugin install cc-smart-dev-kit@cc-smart-dev-kit`, and a fake machine
 * for `runSetup` run in the test's own process. Every command goes to a fake on a PATH of
 * its own (sudo, apt-get, dnf, rpm, brew, gpg, claude, dpkg-query): each logs its call,
 * and the fake `sudo` never runs what it is given. No test reaches a real package
 * manager, a real `claude`, the network, or the real home folder.
 */
import { afterEach, beforeEach, spyOn } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { runSetup, type SetupOptions, statuslineDeclinedFile } from "../cli/setup";
import type { Machine } from "../machine/machine";
import { retryWatchdogDeclinedFile } from "../setup/retry-watchdog";
import { FAKE_CLAUDE_MCP_JS } from "./fake-claude-mcp";
import { tempDir } from "./temp";

export const UBUNTU = 'NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n';
export const FEDORA = 'NAME="Fedora Linux"\nID=fedora\n';
export const ARCH_LINUX = 'NAME="Arch Linux"\nID=arch\n';
export const FAKE_KEY =
  "-----BEGIN PGP PUBLIC KEY BLOCK-----\nfake\n-----END PGP PUBLIC KEY BLOCK-----\n";
/** Warp's key fingerprint, written by hand (the one `gpg --show-keys` prints for warp.asc). */
export const WARP_FPR = "0913165C78D5B7A41B42AC657FF7AB39D60F803F";

/** What `gpg --show-keys --with-colons` prints for one key with this fingerprint. */
export function showKeysOutput(...fingerprints: string[]): string {
  return fingerprints
    .map(
      (fpr) =>
        `pub:-:4096:1:${fpr.slice(-16)}:1707685932:::-:::scESC::::::23::0:\nfpr:::::::::${fpr}:\n`,
    )
    .join("");
}

/** The plugin's real instructions folder: setup installs them as it does for a person. */
const PLUGIN_INSTRUCTIONS = join(import.meta.dir, "..", "..", "plugin", "instructions");

/** Everything the test printed with console.log and console.error (`ERR ` first). */
export const printed: string[] = [];

/**
 * The change lines of setup's report (`  + …`, `  ~ …`, `  - …`, `  $ …`, inside a section): a
 * run that changes nothing prints none.
 */
export function changeLines(): string[] {
  return printed.filter((line) => /^ {2}[+~$-] /.test(line));
}

/** Captures console output in `printed` for each test of the file that calls it. */
export function capturePrinted(): void {
  beforeEach(() => {
    printed.length = 0;
    spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      printed.push(...args.join(" ").split("\n"));
    });
    spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      printed.push(...`ERR ${args.join(" ")}`.split("\n"));
    });
  });
  afterEach(() => {
    (console.log as unknown as { mockRestore(): void }).mockRestore();
    (console.error as unknown as { mockRestore(): void }).mockRestore();
  });
}

export interface WorldOptions {
  os?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  /** null: no terminal. true / false: the answer to every question; a function: per question. */
  answer?: boolean | null | ((question: string) => boolean);
  /** System paths that exist. */
  existing?: string[];
  /** Fake bodies for commands, after the log line; default `exit 0`. */
  bins?: Record<string, string>;
  /** Plugins installed besides cc-smart-dev-kit and its companions. */
  plugins?: string[];
  /** Marketplaces added besides cc-smart-dev-kit and the companions'. */
  marketplaces?: string[];
  /** The real git on the fake PATH (for a real project). Default: no git. */
  git?: boolean;
  /**
   * Setup's status-line question was answered "no" before, so a terminal is not asked it
   * again. Default: true, so a test about other questions sees only those; false asks it.
   */
  statuslineAnswered?: boolean;
  /** The same for the retry watchdog's "no" (`src/setup/retry-watchdog.ts`). Default: true. */
  retryWatchdogDeclined?: boolean;
  /**
   * The fake `claude` keeps what `claude mcp` registers, as Claude Code does
   * (`fake-claude-mcp.ts`), so a second setup finds the servers the first one added. Default:
   * false (every `claude` call just succeeds).
   */
  mcp?: boolean;
}

export function world(options: WorldOptions = {}) {
  const home = tempDir("world");
  const configDir = join(home, ".claude");
  mkdirSync(join(configDir, "plugins"), { recursive: true });
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: configDir });
  const pluginIds = [
    "cc-smart-dev-kit@cc-smart-dev-kit",
    "claude-mem@thedotmack",
    "frontend-design@claude-plugins-official",
    ...(options.plugins ?? []),
  ];
  const installed: Record<string, unknown> = {};
  for (const id of pluginIds) {
    const installPath = join(configDir, "plugins", "cache", id.replace("@", "/"), "1.0.0");
    mkdirSync(installPath, { recursive: true });
    installed[id] = [
      { scope: "user", installPath, version: id.startsWith("claude-mem") ? "13.39.0" : "1.0.0" },
    ];
  }
  writeFileSync(paths.installedPluginsFile, JSON.stringify({ version: 2, plugins: installed }));
  const marketplaces = [
    "cc-smart-dev-kit",
    "thedotmack",
    "claude-plugins-official",
    ...(options.marketplaces ?? []),
  ];
  writeFileSync(
    paths.knownMarketplacesFile,
    JSON.stringify(Object.fromEntries(marketplaces.map((name) => [name, { source: {} }]))),
  );
  writeFileSync(
    paths.settingsFile,
    JSON.stringify({
      enabledPlugins: Object.fromEntries(pluginIds.map((id) => [id, true])),
      extraKnownMarketplaces: {
        "cc-smart-dev-kit": { source: { source: "github", repo: "example-org/cc-smart-dev-kit" } },
      },
    }),
  );

  // The fakes: each logs "<name> <args>" and runs its body. sudo never runs its command.
  const bin = join(home, "fake-bin");
  const log = join(home, "calls.log");
  const staged = join(home, "staged");
  mkdirSync(bin);
  mkdirSync(staged);
  const bodies: Record<string, string> = {
    sudo: [
      // Keep a copy of each file handed to `install`, to check what root would get.
      'if [ "$1" = install ]; then for a do src=$dst; dst=$a; done;',
      `  cp "$src" ${JSON.stringify(staged)}/"$(basename "$dst")"; fi`,
      "exit 0",
    ].join("\n"),
    "apt-get": "exit 0",
    "dpkg-query": "exit 1",
    rpm: "exit 1",
    dnf: "exit 0",
    brew: '[ "$1" = list ] && exit 1; exit 0',
    claude: options.mcp
      ? `[ "$1" = mcp ] && exec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(bin, "fake-claude-mcp.js"))} "$@"\nexit 0`
      : "exit 0",
    // --show-keys: Warp's one key. --dearmor --yes --output OUT IN: a copy stands in.
    gpg: [
      `case "$*" in *--show-keys*) printf '${showKeysOutput(WARP_FPR)}' ;;`,
      '  *--dearmor*) cp "$5" "$4" ;; esac',
    ].join("\n"),
    ...options.bins,
  };
  if (options.mcp) writeFileSync(join(bin, "fake-claude-mcp.js"), FAKE_CLAUDE_MCP_JS);
  for (const [name, body] of Object.entries(bodies)) {
    const file = join(bin, name);
    writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> ${JSON.stringify(log)}\n${body}\n`);
    chmodSync(file, 0o755);
  }
  if (options.git) {
    const realGit = Bun.which("git");
    if (realGit === null) throw new Error("this test needs git");
    symlinkSync(realGit, join(bin, "git"));
  }
  if (options.statuslineAnswered !== false) {
    mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(statuslineDeclinedFile(paths.stateDir), "no\n", { mode: 0o600 });
  }
  if (options.retryWatchdogDeclined !== false) {
    mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
    writeFileSync(retryWatchdogDeclinedFile(paths.stateDir), "no\n", { mode: 0o600 });
  }
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home };
  const questions: string[] = [];
  /** Every `spawnDetached` call, as one line: what a real run would have started. */
  const detached: string[] = [];
  const answer = options.answer === undefined ? true : options.answer;
  const existing = new Set(options.existing ?? []);
  const spawn = (argv: string[]) => {
    const resolved = Bun.which(argv[0] ?? "", { PATH: bin });
    if (resolved === null) return { exitCode: 127, output: `${argv[0]}: not found` };
    const result = Bun.spawnSync([resolved, ...argv.slice(1)], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode ?? 1,
      output: `${result.stdout.toString()}${result.stderr.toString()}`,
    };
  };
  const machine: Machine = {
    run: spawn,
    runOnTerminal: (argv) => spawn(argv).exitCode,
    spawnDetached: (argv) => {
      // A test must never start a real program (the browser): the call is recorded instead.
      detached.push(argv.join(" "));
    },
    which: (command) => Bun.which(command, { PATH: bin }),
    confirm:
      answer === null
        ? null
        : (question) => {
            questions.push(question);
            return typeof answer === "function" ? answer(question) : answer;
          },
    platform: options.platform ?? "linux",
    arch: options.arch ?? "x64",
    osRelease: () => options.os ?? UBUNTU,
    macApp: "/Applications/Warp.app",
    exists: (path) => existing.has(path),
    fetchText: async () => FAKE_KEY,
  };
  const setup = (extra: Partial<SetupOptions> = {}) =>
    runSetup(paths, {
      dryRun: false,
      yes: false,
      warp: false,
      removeWarp: false,
      project: home,
      machine,
      instructions: null,
      instructionsSource: PLUGIN_INSTRUCTIONS,
      statusline: false,
      retryWatchdog: null,
      // No environment of its own: a test that wants a key sets one through `extra`.
      env: {},
      tavilyKeyStdin: null,
      ...extra,
    });
  /**
   * Every call but the read-only questions about what is installed, and the MCP
   * registrations (`claude mcp …`): a test about Warp or setup's files should not have to
   * carry those lines. The MCP registrations are asserted in `src/mcp/register.test.ts` and
   * `src/mcp/mcp.test.ts`.
   */
  const calls = () =>
    (existsSync(log) ? readFileSync(log, "utf8") : "")
      .split("\n")
      .filter((line) => !/^(dpkg-query --status|rpm -q |brew list |claude mcp )/.test(line))
      .join("\n");
  /** The `claude mcp …` calls only, one per line: for a test about the MCP registrations. */
  const mcpCalls = () =>
    (existsSync(log) ? readFileSync(log, "utf8") : "")
      .split("\n")
      .filter((line) => line.startsWith("claude mcp "));
  return { calls, mcpCalls, detached, home, machine, paths, questions, setup, staged, bin };
}
