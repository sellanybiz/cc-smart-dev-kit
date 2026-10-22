/**
 * The Claude Code commands a crew session launch runs, and what it reads from their answers:
 *
 * - `claude --bg -w <worktree> --name … --model … --effort … --permission-mode auto
 *   --autocompact auto --settings <file> "<first line>"` — returns at once and prints
 *   `backgrounded · <short id> · <name>` (proved live, L1a.1: 0.9 s; `--session-id` is ignored
 *   with `--bg`, so the short id is read from that line);
 * - `claude agents --json --all` — one row per session (`id`, `sessionId`, `cwd`, `pid`, `state`
 *   …), read once to record the new session's id and see that agent view lists it. **Not** its
 *   `cwd`: that read shows the launch folder until a `-w` session has entered its worktree
 *   (2.1.308, `docs/claude-code-contract.md`).
 *
 * **Which `claude`:** the one on PATH (`Bun.which`), else the native installer's place,
 * `~/.local/bin` (`claude`; on Windows `claude.exe`, then npm's `claude.cmd`). **A `.cmd` is no
 * executable on Windows:** it runs through `cmd.exe` with one quoted line (`windowsRun`, the
 * hooks' own quoting), which is also why the crew session's settings go in a FILE, never inline JSON —
 * a `"` has no escape on that line.
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { windowsRun } from "../hooks/detached";

type Env = Record<string, string | undefined>;

/** How long one `claude` command may take: `--bg` returns in about a second (L1a.1). */
export const CLAUDE_TIMEOUT_MS = 30_000;

/**
 * The `--autocompact` a crew session gets: `auto`, Claude Code's own window for the model. The kit
 * knows no model's window — `gateway.json` holds none for a backend, and Claude Code knows
 * Claude's own — so no token count follows from anything it reads. The hand-off at
 * `workflow.crew.handoffPercent` (70 %) comes before Claude Code's own compaction either way.
 */
export const CREW_AUTOCOMPACT = "auto";

/** The permission mode every crew session runs in: the person's rules plus auto mode's safety checks. */
export const CREW_PERMISSION_MODE = "auto";

/** What one program run gave back. */
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

/** What a crew session's `claude --bg` names. */
export interface CrewLaunchSpec {
  effort: string;
  model: string;
  name: string;
  /** The first line of its conversation: who it is, and where its brief is. */
  prompt: string;
  /** The settings file that names it to its own session (`CREW_ENV`). */
  settingsFile: string;
  /** The worktree's folder name under `.claude/worktrees/` (`crew-<phase>-<slug>`). */
  worktreeName: string;
}

/** The arguments of a crew session's `claude --bg`, in the order the live proof ran them (L1a.1). */
export function launchArgs(spec: CrewLaunchSpec): string[] {
  return [
    "--bg",
    "-w",
    spec.worktreeName,
    "--name",
    spec.name,
    "--model",
    spec.model,
    "--effort",
    spec.effort,
    "--permission-mode",
    CREW_PERMISSION_MODE,
    "--autocompact",
    CREW_AUTOCOMPACT,
    "--settings",
    spec.settingsFile,
    spec.prompt,
  ];
}

/** `backgrounded · <short id> · <name>`: the line `claude --bg` prints. */
const BACKGROUNDED = /^\s*backgrounded\s+·\s+([0-9a-f]{8})\s+·\s+(\S.*?)\s*$/m;

/** The short id and the name a `claude --bg` printed; null when no such line is there. */
export function parseBackgrounded(output: string): null | { name: string; shortId: string } {
  const found = BACKGROUNDED.exec(output);
  if (found?.[1] === undefined || found[2] === undefined) return null;
  return { name: found[2], shortId: found[1] };
}

/** The words `claude --bg` refuses a repository with that the person never opened (L1a.1). */
const NOT_TRUSTED = /workspace not trusted/i;

/** True when `claude --bg` refused because the person never accepted this repo's trust prompt. */
export function refusedUntrusted(output: string): boolean {
  return NOT_TRUSTED.test(output);
}

/** One row of `claude agents --json`, as much as a launch reads. */
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

/** The row of the session with short id `shortId`: its `id`, or the start of its `sessionId`. */
export function agentRow(rows: AgentRow[], shortId: string): AgentRow | null {
  return (
    rows.find((row) => row.id === shortId) ??
    rows.find((row) => row.sessionId?.startsWith(shortId) === true) ??
    null
  );
}
