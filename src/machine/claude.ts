/**
 * Claude Code's own command, `claude`: finding it, running it, and reading `claude agents
 * --json`. The CLI's `launch`, `sessions` and the portal's agent view all start it this way.
 *
 * **Which `claude`:** the one on PATH (`Bun.which`), else the native installer's place,
 * `~/.local/bin` (`claude`; on Windows `claude.exe`, then npm's `claude.cmd`). **A `.cmd` is no
 * executable on Windows:** it runs through `cmd.exe` with one quoted line (`windowsRun`, the
 * hooks' own quoting); a `"` has no escape on that line.
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { windowsRun } from "../hooks/detached";

type Env = Record<string, string | undefined>;

/** How long one `claude` command may take. */
export const CLAUDE_TIMEOUT_MS = 30_000;

export interface ProgramRun {
  /** The exit code; null when it was killed (a timeout) or never started. */
  exitCode: null | number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Why it never started (the spawner's own words); null when it did. */
  error: null | string;
}

/** Runs a program and waits for it. A test hands in the real one with a fake `claude` on PATH. */
export type RunProgram = (
  argv: string[],
  options: { cwd: string; env: Env; timeoutMs: number; windowsVerbatim: boolean },
) => ProgramRun;

export const realRunProgram: RunProgram = (argv, options) => {
  try {
    const result = Bun.spawnSync(argv, {
      cwd: options.cwd,
      env: options.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: options.timeoutMs,
      windowsHide: true,
      // A `cmd.exe` line is already quoted (`windowsRun`): never quote it a second time.
      windowsVerbatimArguments: options.windowsVerbatim,
    });
    return {
      error: null,
      exitCode: result.signalCode ? null : result.exitCode,
      stderr: result.stderr.toString(),
      stdout: result.stdout.toString(),
      timedOut: result.exitedDueToTimeout === true,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      exitCode: null,
      stderr: "",
      stdout: "",
      timedOut: false,
    };
  }
};

/** What finding and running `claude` needs from the machine. */
export interface ClaudeDeps {
  env: Env;
  /** The home folder (`cliPaths().home`): where the native installer puts `claude`. */
  home: string;
  platform: NodeJS.Platform;
  runProgram: RunProgram;
  /** The full path of a command on PATH, or null. */
  which: (command: string) => null | string;
}

/** True when `path` is a file. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The names the native installer and npm leave in `~/.local/bin`, in the order they are tried. */
function fallbackNames(platform: NodeJS.Platform): string[] {
  return platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
}

/** The `claude` to run: PATH first, then `~/.local/bin`; null when there is none. */
export function findClaude(deps: Pick<ClaudeDeps, "home" | "platform" | "which">): null | string {
  const onPath = deps.which("claude");
  if (onPath !== null) return onPath;
  for (const name of fallbackNames(deps.platform)) {
    const path = join(deps.home, ".local", "bin", name);
    if (isFile(path)) return path;
  }
  return null;
}

/** The argv that runs `claude <args>` here, or why it cannot be run. */
export function claudeArgv(
  binary: string,
  args: string[],
  platform: NodeJS.Platform,
): { argv: string[]; verbatim: boolean } | { why: string } {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(binary)) {
    return { argv: [binary, ...args], verbatim: false };
  }
  const line = windowsRun([binary, ...args]);
  if (!line.ok) return { why: `cmd.exe cannot carry "${line.argument}": ${line.reason}` };
  return { argv: line.argv, verbatim: true };
}

/** One `claude` command's outcome: what it printed, or why it did not run. */
export type ClaudeCall = { ok: true; run: ProgramRun } | { ok: false; why: string };

/** Runs `claude <args>` in `cwd` with `binary` (`findClaude`). */
export function callClaude(
  deps: ClaudeDeps,
  binary: string,
  args: string[],
  cwd: string,
  timeoutMs = CLAUDE_TIMEOUT_MS,
): ClaudeCall {
  const command = claudeArgv(binary, args, deps.platform);
  if ("why" in command) return { ok: false, why: command.why };
  const run = deps.runProgram(command.argv, {
    cwd,
    env: deps.env,
    timeoutMs,
    windowsVerbatim: command.verbatim,
  });
  if (run.error !== null) return { ok: false, why: `${binary} did not start: ${run.error}` };
  return { ok: true, run };
}

/** One row of `claude agents --json`, as much as the kit reads. */
export interface AgentRow {
  cwd: null | string;
  id: null | string;
  pid: null | number;
  sessionId: null | string;
  state: null | string;
  /** `busy`, `waiting` or `idle`: what the session is doing now. */
  status: null | string;
  /** What the session waits for (`permission prompt`, `input needed`, …); null when it waits for nothing. */
  waitingFor: null | string;
}

/** A field as text, or null. */
function textField(value: unknown): null | string {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The rows `claude agents --json` printed; null when it is not a JSON list. */
export function parseAgents(output: string): AgentRow[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  return parsed
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row) => ({
      cwd: textField(row.cwd),
      id: textField(row.id),
      pid: typeof row.pid === "number" ? row.pid : null,
      sessionId: textField(row.sessionId),
      state: textField(row.state),
      status: textField(row.status),
      waitingFor: textField(row.waitingFor),
    }));
}

/** A complete identity view for absence proof: partial rows must never look like missing sessions. */
export function parseAgentPresence(output: string): AgentRow[] | null {
  const rows = parseAgents(output);
  if (rows === null) return null;
  const raw: unknown = JSON.parse(output);
  return Array.isArray(raw) &&
    rows.length === raw.length &&
    rows.every((row) => row.id !== null || row.sessionId !== null)
    ? rows
    : null;
}
