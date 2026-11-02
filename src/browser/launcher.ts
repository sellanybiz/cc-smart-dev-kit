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
 * IT STARTS CHROME AT THE FIRST BROWSER TOOL, NOT AT SESSION START
 *   Extension mode connects by handing a page to Chrome, and the MCP starts Chrome itself only
 *   when it finds it closed — detached, with its output ignored, and with no check of whether it
 *   came up. A machine restart leaves Chrome closed, and a session the Claude daemon starts has no
 *   `DISPLAY` (measured 2026-10-23), so that start died unseen and the MCP waited its full 30 s.
 *   On the first tools/call this launcher starts the Chrome `chrome.ts` finds, with the profile, on the
 *   person's desktop (`chrome-start.ts`), and goes on once Chrome's singleton lock is there. What
 *   cannot start is one plain line naming the one step — never a 30-second wait.
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
 * Only protocol bytes may go to stdout. The launcher's stdout IS the MCP protocol stream; one
 *   stray line and the server shows in Claude Code as failed. Diagnostics go through `log`
 *   (stderr).
 */
import { COMMAND } from "../build-info";
import type { CliPaths } from "../cli/paths";
import { ensurePrivateDir } from "../machine/private-dir";
import { MCP_VERSIONS } from "../mcp/versions";
import { type ChromeDeps, connectPrerequisites } from "./chrome";
import { type DesktopEnvironment, ensureChromeRunning, type StartChrome } from "./chrome-start";
import { type McpSink, proxyMcp } from "./mcp-proxy";
import { BROWSER_TOKEN_ENV, type BrowserToken, readBrowserToken } from "./token";

/** Oldest files are deleted once the output folder grows past this (the MCP's own limit). */
const OUTPUT_MAX_BYTES = 200 * 1024 * 1024;

/** The launcher's own options, taken out before the rest goes to the MCP. */
const OWN_OPTIONS = {
  output: "--output-dir=",
} as const;

/** A process this launcher started (the Playwright MCP). */
export interface McpChild {
  stdin: McpSink;
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill: (signal: NodeJS.Signals) => void;
}

export interface BrowserMcpDeps {
  /**
   * Starts the MCP with piped stdin/stdout and inherited stderr. `env` is added to the child's own
   * environment (the caller merges it over the current one) — the extension token travels there,
   * never in `argv`, which every user on the machine can read from `/proc`. `cwd` is the folder
   * the child must start in: the browser's own, never the session's.
   */
  spawn: (
    argv: string[],
    options: {
      cwd: string;
      env: Record<string, string>;
      stdio: readonly ["pipe", "pipe", "inherit"];
    },
  ) => McpChild;
  clientInput: ReadableStream<Uint8Array>;
  clientOutput: Pick<McpSink, "write" | "flush">;
  /** Chrome's files on this machine: where the `claude-code` profile is (`claudeCodeProfileOn`). */
  chrome: ChromeDeps & { home: string; platform: NodeJS.Platform };
  /**
   * This process's environment: the environment of a Chrome this launcher starts (it inherits
   * HOME, PATH and the rest, as a program the person starts does).
   */
  env: Record<string, string | undefined>;
  /**
   * The person's desktop: `desktopEnvironment` from this environment and the user manager's. It is
   * built by the caller, so its system call is the caller's bounded one (`runDesktopLookup`).
   */
  desktop: () => DesktopEnvironment;
  /** Starts the person's Chrome, detached; the launcher waits for its singleton lock. */
  startChrome: StartChrome;
  log: (line: string) => void;
  /** Finds `bunx` (or any command) on PATH. */
  which: (command: string) => null | string;
  /** Reads the token file; a test hands in its own. */
  readToken?: (paths: CliPaths) => BrowserToken;
  /** The pinned `@playwright/mcp` package, `name@version`. */
  package?: string;
  /** How long a started Chrome gets to come up; a test makes it short. */
  chromeLimitMs?: number;
  /** Waits between readiness questions; a test hands in its own. */
  sleep?: (ms: number) => Promise<void>;
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

  // What the connect step needs, from the files — Chrome, the profile, the extension in it — is
  // answered here first. One of them missing is one plain line; without this the MCP waits its own
  // 30-second deadline and ends in a message about the extension and the token, naming neither
  // what is really missing nor the one command that fixes it.
  const ready = connectPrerequisites(deps.chrome);
  if (!ready.ok) {
    deps.log(ready.why);
    return 2;
  }

  // Handshakes read files only. The proxy checks Chrome at the first browser tool request.
  const startChrome = () =>
    ensureChromeRunning(
      {
        chrome: ready.chrome,
        profileDirName: ready.profile.dirName,
        userDataDir: ready.userDataDir,
      },
      {
        chrome: deps.chrome,
        desktop: deps.desktop,
        env: deps.env,
        startChrome: deps.startChrome,
        ...(deps.chromeLimitMs === undefined ? {} : { limitMs: deps.chromeLimitMs }),
        ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
      },
    );

  // Everything the browser saves goes here, and it can hold a page of a signed-in session: its
  // owner only. The MCP writes into this folder; it is made private before it starts.
  ensurePrivateDir(options.outputDir, deps.log);

  const bunx = deps.which("bunx");
  const head = bunx === null ? [process.execPath, "x"] : [bunx];
  const packageName = deps.package ?? `@playwright/mcp@${MCP_VERSIONS.playwright}`;
  const child = deps.spawn(browserMcpArgv(head, options, packageName, ready.profile.dirName), {
    // A folder the plugin owns, never the session's: no project's bunfig.toml, `.env` or
    // node_modules reaches the child that holds the token.
    cwd: options.outputDir,
    // The token, and nothing else: an environment variable, never an argument.
    env: { [BROWSER_TOKEN_ENV]: token.value },
    stdio: ["pipe", "pipe", "inherit"],
  });

  const proxy = proxyMcp({
    clientInput: deps.clientInput,
    clientOutput: deps.clientOutput,
    childInput: child.stdin,
    childOutput: child.stdout,
    startChrome,
  });
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = signals.map((signal) => [signal, () => child.kill(signal)] as const);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    const exited = child.exited.then(async (code) => {
      // Drain the child's final response before closing our protocol output.
      await proxy.outputDone;
      return code;
    });
    return await Promise.race([exited, proxy.done.then(() => exited)]);
  } catch (error) {
    deps.log(`browser MCP stream failed: ${String(error)}`);
    child.kill("SIGTERM");
    return await child.exited;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
    await proxy.stop();
  }
}
