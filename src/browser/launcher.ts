/**
 * `cc-smart-dev-kit browser mcp` — the Playwright MCP server, on the ONE Chrome every
 * session shares.
 *
 * WHAT IT STARTS
 *   1. A tab filter on a free local port (`cdp-tab-filter-server.ts`), which is what the MCP
 *      is pointed at — through `PLAYWRIGHT_MCP_CDP_ENDPOINT` in its environment, never an
 *      argument: the endpoint carries a token, and `argv` is readable by every user on the
 *      machine. The MCP connects on its first browser call; the filter then makes sure the
 *      shared Chrome runs — starting it, detached, when no session has (`shared-browser.ts`)
 *      — and passes every message through.
 *   2. The Playwright MCP itself, at the pinned version (`src/mcp/versions.ts`), through
 *      `bunx`. Its stdout is the MCP protocol stream, and this process hands it straight on:
 *      NOTHING here may write to stdout.
 *
 * WHY THE FILTER
 *   Stock Playwright, attached to a running Chrome, adopts EVERY tab in it, so a new session
 *   would start on another session's tab (microsoft/playwright#42961, no fix upstream). The
 *   filter shows this session only the pages it opened and the popups those opened, and when
 *   the MCP lets go — `browser_close`, ten idle minutes, or the session ending — it closes
 *   this session's windows. The shared Chrome and its logins stay.
 *
 * WHERE FILES GO
 *   Everything the browser saves — screenshots, page snapshots, console and network logs —
 *   goes to ONE folder, `cliPaths().browserOutputDir`, kept under `OUTPUT_MAX_BYTES` by the
 *   MCP itself. Downloads go to `<that folder>/traces`, which is the MCP's artifacts folder
 *   over CDP.
 *
 * UPLOADING A FILE
 *   While Claude is acting, Playwright takes a file picker over and waits for the
 *   `browser_file_upload` tool to hand it a file. The rest of the time a person's click opens
 *   the normal picker: `picker.ts`, loaded for every tab with `--init-page`, holds the picker
 *   only during Claude's browser calls and for two seconds after. The file is written beside
 *   the profile (`cliPaths().browserPickerFile`) from the plugin's own bundle, because the
 *   MCP loads it again for every tab and a plugin's version folder is deleted on update.
 *
 *   By default the upload tool accepts a file only from inside the folder the server was
 *   launched in — and a session's files are in its worktree, outside it — so the server runs
 *   with `--allow-unrestricted-file-access`. The session reads any file with its own tools
 *   anyway, so that limit guarded nothing.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CliPaths } from "../cli/paths";
import { LOCK_PORTS } from "../ports";
import { atomicWrite } from "../setup/write";
import { serveTabFilter, type TabFilterServer } from "./cdp-tab-filter-server";
import { ensurePrivateDir, ensureSharedBrowser } from "./shared-browser";

/** Oldest files are deleted once the output folder grows past this (the MCP's own limit). */
const OUTPUT_MAX_BYTES = 200 * 1024 * 1024;

/**
 * Let go of the browser after this long with no browser tool call; the next call connects
 * again on its own.
 *
 * Letting go closes this session's windows — the shared Chrome and its logins stay — so
 * windows from a check done an hour ago do not pile up. Ten minutes outlasts the pause while
 * code is edited between two checks; reconnecting takes a moment and only the open page is
 * lost. An `--idle-timeout` passed in the registered arguments wins over this.
 */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** The launcher's own options, taken out before the rest goes to the MCP. */
const OWN_OPTIONS = {
  lockPort: "--start-lock-port=",
  output: "--output-dir=",
  profile: "--shared-profile=",
} as const;

/** The launcher's own flag: start the shared Chrome without a window (a machine with no desktop). */
const HEADLESS = "--headless";

/** A process this launcher started (the Playwright MCP). */
export interface McpChild {
  exited: Promise<number>;
  kill: (signal: NodeJS.Signals) => void;
}

export interface BrowserMcpDeps {
  /** The pinned `@playwright/mcp` package. */
  package: string;
  /** The bundle holding the init page (`plugin/dist/browser-picker.js`). */
  pickerBundle: string;
  /**
   * Starts the MCP. Its stdout is this process's stdout. `env` is added to the child's own
   * environment (the caller merges it over the current one) — the CDP endpoint travels there,
   * never in `argv`, which every user on the machine can read from `/proc`.
   */
  spawn: (argv: string[], options: { env: Record<string, string>; stdio: "inherit" }) => McpChild;
  /** Writes the init page beside the profile. */
  installPicker?: (target: string, source: string) => void;
  log: (line: string) => void;
  /** Finds `bunx` (or any command) on PATH. */
  which: (command: string) => null | string;
  /** Starts the filter; a test hands in a fake. */
  serve?: typeof serveTabFilter;
}

/** Writes the plugin's init page beside the profile when it differs. A running MCP loads it
 *  again for every tab, so it has to be a path that outlives a plugin version. */
export function installPicker(target: string, source: string): void {
  if (!existsSync(source)) return;
  const wanted = readFileSync(source, "utf8");
  if (existsSync(target) && readFileSync(target, "utf8") === wanted) return;
  atomicWrite(target, wanted, 0o644);
}

/** One of the launcher's own options, or undefined. */
function ownOption(argv: readonly string[], prefix: string): string | undefined {
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

export interface BrowserMcpOptions {
  /** Start Chrome without a window (`--headless`): for a machine with no desktop. */
  headless: boolean;
  /** The profile folder (default: the shared one). `browser check` passes a throwaway. */
  profileDir: string;
  outputDir: string;
  lockPort: number;
  /** Everything not one of the launcher's own options. */
  mcpArgs: string[];
}

/** Reads the launcher's own arguments. Throws with a message a person can act on. */
export function browserMcpOptions(paths: CliPaths, argv: readonly string[]): BrowserMcpOptions {
  const lockText = ownOption(argv, OWN_OPTIONS.lockPort);
  const lockPort = lockText === undefined ? LOCK_PORTS.browserStart : Number(lockText);
  if (!Number.isInteger(lockPort) || lockPort <= 0) {
    throw new Error(`${OWN_OPTIONS.lockPort} needs a port number`);
  }
  return {
    headless: argv.includes(HEADLESS),
    lockPort,
    mcpArgs: argv.filter(
      (arg) =>
        arg !== HEADLESS && !Object.values(OWN_OPTIONS).some((prefix) => arg.startsWith(prefix)),
    ),
    outputDir: ownOption(argv, OWN_OPTIONS.output) ?? paths.browserOutputDir,
    profileDir: ownOption(argv, OWN_OPTIONS.profile) ?? paths.browserProfileDir,
  };
}

/**
 * Runs the server until it exits, and returns its exit code. The filter closes this
 * session's pages first on every stop path — Claude Code may not wait long after its signal.
 */
export async function runBrowserMcp(
  paths: CliPaths,
  argv: readonly string[],
  deps: BrowserMcpDeps,
): Promise<number> {
  const options = browserMcpOptions(paths, argv);
  (deps.installPicker ?? installPicker)(paths.browserPickerFile, deps.pickerBundle);
  // Everything the browser saves goes here, and it can hold a page of a signed-in session:
  // its owner only, like the profile.
  ensurePrivateDir(options.outputDir, deps.log);

  const filter: TabFilterServer = (deps.serve ?? serveTabFilter)({
    browserEndpoint: () =>
      ensureSharedBrowser({
        ...(options.headless ? { extraArgs: ["--headless=new"] } : {}),
        lockPort: options.lockPort,
        log: deps.log,
        profileDir: options.profileDir,
      }),
    downloadsPath: join(options.outputDir, "traces"),
    log: deps.log,
  });

  const idleArgs = options.mcpArgs.some((arg) => arg.startsWith("--idle-timeout"))
    ? []
    : [`--idle-timeout=${String(IDLE_TIMEOUT_MS)}`];
  const bunx = deps.which("bunx");
  const argvHead = bunx === null ? [process.execPath, "x"] : [bunx];
  const child = deps.spawn(
    [
      ...argvHead,
      "-y",
      deps.package,
      ...idleArgs,
      `--output-dir=${options.outputDir}`,
      `--output-max-size=${String(OUTPUT_MAX_BYTES)}`,
      // A session in a worktree has another folder than the one this server was started in,
      // so a path relative to "the workspace" would point nowhere.
      "--file-paths=absolute",
      // Without it the upload tool refuses every file outside the folder the session was
      // launched in, and a worktree is outside it.
      "--allow-unrestricted-file-access",
      // Holds the file picker for Claude only while it is acting, so a person's click opens
      // the normal one.
      `--init-page=${paths.browserPickerFile}`,
      ...options.mcpArgs,
    ],
    {
      // The tab filter's own endpoint, token and all. An environment variable, never an
      // argument: `--cdp-endpoint` in argv would show the token to every user on the machine
      // (`/proc/<pid>/cmdline` is world-readable).
      env: { PLAYWRIGHT_MCP_CDP_ENDPOINT: filter.endpoint },
      stdio: "inherit",
    },
  );

  /** Close this session's windows first, then hand the signal on. */
  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    await filter.close();
    child.kill(signal);
  };
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) {
    process.on(signal, () => {
      stop(signal).catch((error: unknown) => {
        deps.log(
          `closing this session's windows failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        child.kill(signal);
      });
    });
  }

  const exitCode = await child.exited;
  await filter.close();
  return exitCode;
}
