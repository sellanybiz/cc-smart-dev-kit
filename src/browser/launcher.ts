/**
 * `cc-smart-dev-kit browser mcp` — the Playwright MCP server, on the person's own Chrome, through
 * the Playwright extension.
 *
 * WHAT IT STARTS
 *   The pinned `@playwright/mcp` (`src/mcp/versions.ts`) with `--extension`, so it does NOT start
 *   a browser of its own: it connects to the Chrome the person already has, in the ONE profile
 *   named `claude-code`, through the Playwright extension installed there. `--profile-dir-name`
 *   is that profile's FOLDER name as `claudeCodeProfileOn` finds it — the same answer `doctor`
 *   gives, so a profile made in Chrome's own dialog (`Profile 2`) is the one the MCP is told.
 *   Every session gets its own tab group in that profile (`Playwright · claude-code`, `(2)`, …)
 *   and the person can watch and take over.
 *
 * IT RUNS IN A FOLDER OF ITS OWN
 *   Claude Code starts this launcher in the session's folder. The MCP child is started in the
 *   browser's output folder instead: bun reads the working folder's `bunfig.toml` (its `preload`)
 *   and `.env` for every bun it starts, and bunx looks in its `node_modules` first — so in a
 *   project's folder the child that holds the browser token would run the project's own code.
 *
 * THE TOKEN IS REQUIRED, AND IT IS NEVER IN `argv`
 *   Without a token the extension opens an approval page and waits for a click — for EVERY
 *   connection — so this launcher refuses to start without one and says what to run. The token
 *   comes from the person's own file (`browser/token.ts`) and goes into the child's ENVIRONMENT
 *   only: `argv` is world-readable (`/proc`), and `~/.claude.json` reaches no secret.
 *
 * THE COSTS THE OWNER ACCEPTED (both upstream, neither planned to change)
 *   - Every connection brings the `claude-code` window to the front and switches its active tab:
 *     microsoft/playwright#42343, closed as not planned.
 *   - The `claude-code` profile must hold the Playwright extension and NOTHING else: a second
 *     extension that injects a frame from its own `chrome-extension://` origin breaks the session
 *     (microsoft/playwright#43230, open). `doctor` checks it.
 *   `browser setup` prints both, and how to set the profile up.
 *
 * WHERE FILES GO
 *   Everything the browser saves — screenshots, page snapshots, console and network logs — goes to
 *   ONE folder, `cliPaths().browserOutputDir`, kept under `OUTPUT_MAX_BYTES` by the MCP itself. A
 *   file the CALLER names by a relative name is put there by the `playwright-output` hook, because
 *   the MCP resolves such a name against the folder the server was started in (which is this
 *   folder too, now; the hook still makes the name absolute, so it never depends on that).
 *
 * 🔴 NOTHING HERE MAY WRITE TO STDOUT. The launcher's stdout IS the MCP protocol stream; one
 *   stray line and the server shows in Claude Code as failed. Every line goes through `log`
 *   (stderr).
 */
import { COMMAND } from "../build-info";
import type { CliPaths } from "../cli/paths";
import { ensurePrivateDir } from "../machine/private-dir";
import { MCP_VERSIONS } from "../mcp/versions";
import { type ChromeDeps, CLAUDE_CODE_PROFILE, claudeCodeProfileOn } from "./chrome";
import { BROWSER_TOKEN_ENV, type BrowserToken, readBrowserToken } from "./token";

/** Oldest files are deleted once the output folder grows past this (the MCP's own limit). */
const OUTPUT_MAX_BYTES = 200 * 1024 * 1024;

/** The launcher's own options, taken out before the rest goes to the MCP. */
const OWN_OPTIONS = {
  output: "--output-dir=",
} as const;

/** A process this launcher started (the Playwright MCP). */
export interface McpChild {
  exited: Promise<number>;
  kill: (signal: NodeJS.Signals) => void;
}

export interface BrowserMcpDeps {
  /**
   * Starts the MCP. Its stdout is this process's stdout. `env` is added to the child's own
   * environment (the caller merges it over the current one) — the extension token travels there,
   * never in `argv`, which every user on the machine can read from `/proc`. `cwd` is the folder
   * the child must start in: the browser's own, never the session's.
   */
  spawn: (
    argv: string[],
    options: { cwd: string; env: Record<string, string>; stdio: "inherit" },
  ) => McpChild;
  /** Chrome's files on this machine: where the `claude-code` profile is (`claudeCodeProfileOn`). */
  chrome: ChromeDeps & { home: string; platform: NodeJS.Platform };
  log: (line: string) => void;
  /** Finds `bunx` (or any command) on PATH. */
  which: (command: string) => null | string;
  /** Reads the token file; a test hands in its own. */
  readToken?: (paths: CliPaths) => BrowserToken;
  /** The pinned `@playwright/mcp` package, `name@version`. */
  package?: string;
}

/** One of the launcher's own options, or undefined. */
function ownOption(argv: readonly string[], prefix: string): string | undefined {
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

export interface BrowserMcpOptions {
  /** Everything not one of the launcher's own options. */
  mcpArgs: string[];
  outputDir: string;
}

/** Reads the launcher's own arguments. Throws with a message a person can act on. */
export function browserMcpOptions(paths: CliPaths, argv: readonly string[]): BrowserMcpOptions {
  return {
    mcpArgs: argv.filter(
      (arg) => !Object.values(OWN_OPTIONS).some((prefix) => arg.startsWith(prefix)),
    ),
    outputDir: ownOption(argv, OWN_OPTIONS.output) ?? paths.browserOutputDir,
  };
}

/**
 * The exact `argv` of the Playwright MCP. Pure, so a test can read it: `--extension` and the
 * profile's folder name are the mode; `--output-dir` is where the files it names itself go;
 * `--allow-unrestricted-file-access` is what lets it reach a session's files in a worktree AND
 * open a `file://` page (blocked by default); `--file-paths=absolute` is what makes the paths it
 * reports usable from any folder.
 */
export function browserMcpArgv(
  head: string[],
  options: BrowserMcpOptions,
  packageName: string,
  profileDirName: string,
): string[] {
  return [
    ...head,
    "-y",
    packageName,
    "--extension",
    "--browser=chrome",
    `--profile-dir-name=${profileDirName}`,
    `--output-dir=${options.outputDir}`,
    `--output-max-size=${String(OUTPUT_MAX_BYTES)}`,
    "--file-paths=absolute",
    "--allow-unrestricted-file-access",
    ...options.mcpArgs,
  ];
}

/**
 * The one line a session's start shows when there is no token: what is wrong, and the command
 * that fixes it. It goes to stderr (stdout is the protocol stream), and the process then exits
 * non-zero, so Claude Code reports the server as failed instead of starting a browser that would
 * ask a person to approve every connection.
 */
export function noTokenMessage(paths: CliPaths, reason: string): string {
  return (
    `the Playwright extension token is not set, so the browser would ask you to approve every ` +
    `connection, and cc-smart-dev-kit never runs that way (${reason}). ` +
    `Run: ${COMMAND} browser setup, then ${COMMAND} browser token (token file: ${paths.browserTokenFile})`
  );
}

/**
 * Runs the server until it exits, and returns its exit code. Nothing is started without a token:
 * the token is read first, and a missing or unusable one ends the run with one stderr line.
 *
 * A token that no longer matches the extension (it was regenerated, or the extension was
 * reinstalled) does NOT fall back to the approval page: the extension answers the connect page
 * with "Invalid token provided." (`packages/extension/src/ui/connect.tsx`), and the MCP itself
 * fails after its own 30-second deadline with a message naming the profile and the variable
 * (`playwright-core`'s `cdpRelay.ts`). Nothing here retries, so no page is ever popped twice.
 */
export async function runBrowserMcp(
  paths: CliPaths,
  argv: readonly string[],
  deps: BrowserMcpDeps,
): Promise<number> {
  const options = browserMcpOptions(paths, argv);
  const token = (deps.readToken ?? readBrowserToken)(paths);
  if (token.source === "none") {
    deps.log(noTokenMessage(paths, token.reason));
    return 2;
  }

  // Everything the browser saves goes here, and it can hold a page of a signed-in session: its
  // owner only. The MCP writes into this folder; it is made private before it starts.
  ensurePrivateDir(options.outputDir, deps.log);

  const bunx = deps.which("bunx");
  const head = bunx === null ? [process.execPath, "x"] : [bunx];
  const packageName = deps.package ?? `@playwright/mcp@${MCP_VERSIONS.playwright}`;
  // The folder `doctor` names. No profile yet: the plugin's own name, so the MCP's own error
  // names the profile `browser setup` makes.
  const profileDirName = claudeCodeProfileOn(deps.chrome)?.dirName ?? CLAUDE_CODE_PROFILE;
  const child = deps.spawn(browserMcpArgv(head, options, packageName, profileDirName), {
    // A folder the plugin owns, never the session's: no project's bunfig.toml, `.env` or
    // node_modules reaches the child that holds the token.
    cwd: options.outputDir,
    // The token, and nothing else: an environment variable, never an argument.
    env: { [BROWSER_TOKEN_ENV]: token.value },
    stdio: "inherit",
  });

  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }
  return await child.exited;
}
