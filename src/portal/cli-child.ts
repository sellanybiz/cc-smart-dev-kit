/**
 * The CLI's own command, in a child process: the portal's one spawn of `dist/cli.js`.
 *
 * Three callers need it, for one reason: the work is the CLI's own code, and it is too slow for
 * the server's event loop. An action (`runCliChild`) runs a command that changes something; the
 * flow report and the worktrees scan (`runCliChildText`) each read an answer the CLI already
 * builds. The crew commands and `worktrees --clean` run git, `claude` and the worktree scan with
 * **synchronous** spawns (`Bun.spawnSync`); `readFlow` reads every saved session's transcript
 * with synchronous file reads (about 200 ms warm and 10 s on a cold cache, measured 2026-10-23);
 * the worktree scan runs git and the machine's own readers. Run inside the portal's server, one
 * of them froze every page, every other action and the live stream for up to 30 s per call —
 * and `crew rm` makes several. So nothing here runs the CLI's functions in the server: the
 * portal runs the same command the CLI runs (`dist/cli.js`) in a child, spawned with
 * `Bun.spawn` (never `spawnSync`). The work is still the CLI's own code — the same functions,
 * the same checks, the same words — and the server stays free while it runs.
 *
 * The child gets the plugin's two bun flags (`--no-env-file`, the plugin's own `--config`), the
 * portal's own `HOME` and `CLAUDE_CONFIG_DIR` (whatever its environment says), and no
 * `CC_SMART_DEV_KIT_CREW`: the person at the portal is the caller, not the crew session whose
 * session start may have started the portal (D52).
 */
import { join } from "node:path";
import { bunConfigArg } from "../setup/bun-config";
import { commandContext } from "../update/apply";
import type { PortalContext } from "./context";

/**
 * How long one CLI child may take. `crew rm` runs several calls with 30 s limits each (git, a
 * stop, a scan); `worktrees --clean` fetches, scans and removes. A cold flow read on a big
 * machine took 10 s. Well inside a page's patience, and far longer than any single call it
 * makes.
 */
export const CLI_CHILD_TIMEOUT_MS = 180_000;

/** What one CLI child came to: its lines in arrival order, its exit code, or why it did not run. */
export interface CliChild {
  /** Why it never started, or why it was ended before it finished (a signal); null when it ran. */
  error: null | string;
  /** Its exit code; null when a timeout killed it or it never ran. */
  exitCode: null | number;
  /** Every non-empty line it printed, stdout and stderr together. */
  lines: string[];
  /** True when the timeout ended it. */
  timedOut: boolean;
}

/**
 * Why a child never ran: `folder` is the plugin's folder saying why in its own words (a page
 * shows them as they are), `spawn` is `Bun.spawn` failing (the caller names its own subject).
 */
export type CliStartFailure = { error: string; kind: "folder" | "spawn" };

/** A child that runs, off the server's loop, and when it started. */
export interface CliStart {
  child: Bun.Subprocess<"ignore", "pipe", "pipe">;
  kind: "started";
  startedAt: number;
}

/**
 * The argv of one CLI child: the plugin's own bun, its two flags and the CLI's bundle, then the
 * command. One home, so the readers and the actions can never run it differently.
 */
function cliChildArgv(folder: string, args: readonly string[]): string[] {
  return [
    process.execPath,
    "--no-env-file",
    bunConfigArg(folder),
    join(folder, "dist", "cli.js"),
    ...args,
  ];
}

/**
 * The environment one CLI child gets: the portal's own paths, whatever the portal's environment
 * says, so the child reads the same store, settings and gateway config the server does — and no
 * `CC_SMART_DEV_KIT_CREW`: the person's click is not a crew session (D52), whatever process
 * started the portal.
 */
function cliChildEnv(
  ctx: PortalContext,
  context: ReturnType<typeof commandContext>,
): Record<string, string> {
  const env: Record<string, string> = {
    ...context.env,
    CLAUDE_CONFIG_DIR: ctx.paths.claudeConfigDir,
    HOME: ctx.paths.home,
  };
  delete env.CC_SMART_DEV_KIT_CREW;
  return env;
}

/**
 * Starts `dist/cli.js <args>` in `cwd` (the portal's folder unless the caller asks for another:
 * the crew record's repository, or the worktrees scan's folder), asynchronously. Never throws.
 */
function spawnCliChild(
  ctx: PortalContext,
  args: readonly string[],
  options: { cwd?: null | string; timeoutMs?: number },
): CliStart | CliStartFailure {
  const folder = ctx.pluginFolder();
  if ("error" in folder) return { error: folder.error, kind: "folder" };
  const context = commandContext(ctx.env, ctx.paths.home);
  try {
    const child = Bun.spawn(cliChildArgv(folder.folder, args), {
      cwd: options.cwd ?? context.cwd,
      env: cliChildEnv(ctx, context),
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
      timeout: options.timeoutMs ?? CLI_CHILD_TIMEOUT_MS,
      windowsHide: true,
    });
    return { child, kind: "started", startedAt: Date.now() };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      kind: "spawn",
    };
  }
}

/**
 * What the child came to, once it has exited: its exit code, or why it was ended (a signal).
 * Bun kills a child past its `timeout` with a signal; any other signal (an OOM kill, a person's
 * `kill`) is not a timeout, and the line says so rather than blaming slowness. The clock is
 * compared with slack: the kill and this check are not the same instant.
 */
function endCliChild(
  start: CliStart,
  timeoutMs: number,
  code: null | number,
): Omit<CliChild, "lines"> {
  const signal = start.child.signalCode ?? null;
  if (signal === null) return { error: null, exitCode: code, timedOut: false };
  if (Date.now() - start.startedAt >= timeoutMs - 5_000) {
    return { error: null, exitCode: null, timedOut: true };
  }
  return {
    error: `the command was ended by a signal (${String(signal)}) before it finished`,
    exitCode: null,
    timedOut: false,
  };
}

/** A child's pipe read as whole lines, each handed to `push` as it arrives. */
async function readLines(
  stream: ReadableStream<Uint8Array> | number | undefined,
  push: (line: string) => void,
): Promise<void> {
  if (stream === undefined || typeof stream === "number") return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    const parts = rest.split("\n");
    rest = parts.pop() ?? "";
    for (const line of parts) push(line);
  }
  rest += decoder.decode();
  if (rest !== "") push(rest);
}

/**
 * Runs `dist/cli.js <args>` in `cwd` (the crew record's repository, or the portal's folder),
 * collecting every line as it is printed and handing each to `onLine` while it runs (the live
 * stream shows an action's progress). Never throws: a failure is `error` in words.
 */
export async function runCliChild(
  ctx: PortalContext,
  args: string[],
  options: { cwd: null | string; onLine?: (line: string) => void; timeoutMs?: number },
): Promise<CliChild> {
  const start = spawnCliChild(ctx, args, options);
  if (start.kind !== "started") {
    return {
      error: start.kind === "spawn" ? `the command did not start: ${start.error}` : start.error,
      exitCode: null,
      lines: [],
      timedOut: false,
    };
  }
  const lines: string[] = [];
  const push = (line: string): void => {
    const trimmed = line.replace(/\r$/, "");
    if (trimmed.trim() === "") return;
    lines.push(trimmed);
    options.onLine?.(trimmed);
  };
  try {
    await Promise.all([readLines(start.child.stdout, push), readLines(start.child.stderr, push)]);
    const code = await start.child.exited;
    return { ...endCliChild(start, options.timeoutMs ?? CLI_CHILD_TIMEOUT_MS, code), lines };
  } catch (error) {
    return {
      error: `the command did not start: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: null,
      lines,
      timedOut: false,
    };
  }
}

/**
 * One CLI child's whole output, as text: for a reader that parses its JSON answer (`report
 * --json`, `worktrees --json`). A reader words its own failure — its own subject, its own exit
 * sentence — so the two say what each read was.
 */
export type CliTextRun =
  | CliStartFailure
  | { errors: string; exitCode: null | number; kind: "ran"; output: string };

/** Runs one CLI child and hands back everything it printed; never throws. */
export async function runCliChildText(
  ctx: PortalContext,
  args: string[],
  options: { cwd?: null | string; timeoutMs?: number } = {},
): Promise<CliTextRun> {
  const start = spawnCliChild(ctx, args, options);
  if (start.kind !== "started") return start;
  try {
    const [output, errors, exitCode] = await Promise.all([
      new Response(start.child.stdout).text(),
      new Response(start.child.stderr).text(),
      start.child.exited,
    ]);
    return { errors, exitCode, kind: "ran", output };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), kind: "spawn" };
  }
}
