/**
 * The CLI's own command, in a child process, for an action that changes something.
 *
 * The crew commands and `worktrees --clean` run git, `claude` and the worktree scan with
 * **synchronous** spawns (`Bun.spawnSync`). Run inside the portal's server, one of them froze
 * every page, every other action and the live stream for up to 30 s per call — and `crew rm`
 * makes several. So the action never calls those functions in the server: it runs the same
 * command the CLI runs (`dist/cli.js`) in a child, spawned with `Bun.spawn` (never
 * `spawnSync`), the way `flow-read.ts` runs `report --json`. The action is still the CLI's own
 * code — the same functions, the same checks, the same words — and the server stays free while
 * it runs.
 *
 * The child gets the plugin's two bun flags (`--no-env-file`, the plugin's own `--config`), the
 * portal's own `HOME` and `CLAUDE_CONFIG_DIR` (whatever its environment says), and no
 * `CC_SMART_DEV_KIT_CREW` and no `CLAUDECODE`: the person at the portal is the caller, not the
 * crew session whose session start may have started the portal (D52), and not a Claude Code
 * session either (D9) — a command that refuses a session (a review-gate setting, D57) must not
 * refuse the person's own click.
 */
import { join } from "node:path";
import { bunConfigArg } from "../setup/bun-config";
import { commandContext } from "../update/apply";
import type { PortalContext } from "./context";

/**
 * How long one CLI child may take. `crew rm` runs several calls with 30 s limits each (git, a
 * stop, a scan); `worktrees --clean` fetches, scans and removes. Well inside a page's patience,
 * and far longer than any single call it makes.
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
  const folder = ctx.pluginFolder();
  if ("error" in folder) {
    return { error: folder.error, exitCode: null, lines: [], timedOut: false };
  }
  const context = commandContext(ctx.env, ctx.paths.home);
  const env: Record<string, string> = {
    ...context.env,
    // The portal's own paths, whatever its environment says: the child reads the same store,
    // settings and gateway config the server does.
    CLAUDE_CONFIG_DIR: ctx.paths.claudeConfigDir,
    HOME: ctx.paths.home,
  };
  // The person's click is not a crew session (D52), whatever process started the portal.
  delete env.CC_SMART_DEV_KIT_CREW;
  // …and it is not a Claude Code session either (D9, D57). The portal usually starts from a
  // SessionStart hook, so it inherits `CLAUDECODE=1` and hands it to every child; a command that
  // refuses inside a session — a review-gate setting above all — would then refuse the person's
  // own click. From the browser the person changes the project's policy through a pull request,
  // which they review and merge: the button is the person's, and the pull request is the gate.
  delete env.CLAUDECODE;
  const lines: string[] = [];
  const push = (line: string): void => {
    const trimmed = line.replace(/\r$/, "");
    if (trimmed.trim() === "") return;
    lines.push(trimmed);
    options.onLine?.(trimmed);
  };
  try {
    const startedAt = Date.now();
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        bunConfigArg(folder.folder),
        join(folder.folder, "dist", "cli.js"),
        ...args,
      ],
      {
        cwd: options.cwd ?? context.cwd,
        env,
        stderr: "pipe",
        stdin: "ignore",
        stdout: "pipe",
        timeout: options.timeoutMs ?? CLI_CHILD_TIMEOUT_MS,
        windowsHide: true,
      },
    );
    await Promise.all([readLines(child.stdout, push), readLines(child.stderr, push)]);
    const code = await child.exited;
    const signal = child.signalCode ?? null;
    if (signal === null) return { error: null, exitCode: code, lines, timedOut: false };
    // Bun kills a child past its `timeout` with a signal; any other signal (an OOM kill, a
    // person's `kill`) is not a timeout, and the line says so rather than blaming slowness.
    // The clock is compared with slack: the kill and this check are not the same instant.
    const limit = options.timeoutMs ?? CLI_CHILD_TIMEOUT_MS;
    if (Date.now() - startedAt >= limit - 5_000) {
      return { error: null, exitCode: null, lines, timedOut: true };
    }
    return {
      error: `the command was ended by a signal (${String(signal)}) before it finished`,
      exitCode: null,
      lines,
      timedOut: false,
    };
  } catch (error) {
    return {
      error: `the command did not start: ${error instanceof Error ? error.message : String(error)}`,
      exitCode: null,
      lines,
      timedOut: false,
    };
  }
}
