/**
 * Starting a program that must outlive the process that starts it: the background update
 * check, the notifier, the usage-limit worker. A hook returns at once — Claude Code must
 * never wait for them — so each of them has to survive the hook's exit.
 *
 * Linux and macOS: `detached: true` gives the child its own session, so it does.
 *
 * Windows: it does not. Bun puts every child in a kill-on-close job object, and `detached`
 * does not break out of it, so the child dies the moment the hook exits
 * (oven-sh/bun#31603). There the program is started through `cmd /c start "" /b`, which
 * launches it as a job-breakaway process; the trampoline itself is waited for (it returns
 * at once), so the program is running before the hook returns. What must never be waited
 * for is the program.
 *
 * Why the line is built here, one quoted argument at a time: the trampoline hands cmd.exe a
 * **line**, and cmd.exe reads that line itself before anything runs. An argument with a `&`
 * in it starts a second command, a `^` eats the character after it, and `%name%` becomes
 * that variable's value — inside double quotes too. So the line is quoted here for cmd.exe
 * and handed over **verbatim** (`windowsVerbatimArguments`: without it the spawner would
 * escape the quotes this code put there), and an argument cmd.exe cannot carry is refused
 * with a reason: nothing is started rather than a mangled line.
 *
 * The rules, and where they come from — Microsoft's own `cmd` page: "The ampersand &, pipe |
 * and parentheses ( ) are special characters that must be preceded by the escape character
 * ^ or quotation marks when you pass them as arguments", and "You must use quotation marks
 * around the following special characters: & < > [ ] | { } ^ = ; ! ' + , ` ~ [white
 * space]"; `/d` "disables execution of AutoRun commands"; `/s` "triggers special
 * non-parsing rules that strip the first and last quotes around the <string> but leaves the
 * rest of the command unchanged"; `/v:off` "disables delayed environment variable
 * expansion". The one character nothing escapes at a command line is `%`: ss64, "Escape
 * Percents" — "Many characters such as \ = ( ) do not need to be escaped when they are used
 * within a quoted string … The % character is one exception to this rule … it will be
 * evaluated as a variable name even within a quoted string"; doubling it (`%%`) is a
 * batch-file rule only, and `^` is read after that replacement.
 */
import { spawn } from "node:child_process";

/** The program the trampoline runs: `cmd`, which Windows resolves from PATH. */
const CMD = "cmd";

/**
 * The switches between `cmd` and the line:
 *
 * - `/d` — no AutoRun command. Without it cmd runs the `AutoRun` value of the registry
 *   (`HKCU\Software\Microsoft\Command Processor`) before every line it is given, so a hook
 *   would run it too.
 * - `/s` — strip exactly the pair of quotes this code puts around the whole line, and take
 *   what is inside as the command, unchanged. Without it cmd decides with its own rule
 *   ("if the first character is an opening quotation mark, it is stripped along with the
 *   closing quotation mark"), and a line whose last argument is quoted loses that quote.
 * - `/v:off` — no delayed expansion, so a `!` in an argument stays a `!` whatever this
 *   machine's registry says (with it on, `!name!` expands, inside double quotes too).
 * - `/c` — run the line, then exit. The trampoline's own exit is waited for (it returns at
 *   once); the program it starts is never waited for.
 */
const CMD_ARGUMENTS = ["/d", "/s", "/v:off", "/c"];

/**
 * Why cmd.exe cannot carry this argument at all, or null when it can. Three things it has no
 * way to take:
 *
 * - `"` would end the quoting, and cmd.exe has no escape for one inside it (a Windows path
 *   cannot hold a `"` in any case);
 * - `%` starts a variable name and is replaced by its value, inside double quotes too. A
 *   lone `%` is harmless, but whether a given one pairs with another `%` later on the same
 *   line depends on the other arguments, so the rule here is the simple one: no `%` at all;
 * - a line break (or a NUL) ends the line.
 */
function unableInCmd(argument: string): null | string {
  if (argument.includes('"')) return 'a " would end the quoted argument';
  if (argument.includes("%")) return "a % is read as a variable name, inside double quotes too";
  if (/[\r\n]/.test(argument)) return "a line break ends the command line";
  if (argument.includes("\u0000")) return "a NUL ends the command line";
  return null;
}

/** One argument as cmd.exe must read it, or the reason it cannot be carried. */
export type CmdArgument = { ok: true; text: string } | { ok: false; reason: string };

/**
 * One argument as it goes on the cmd.exe line: wrapped in double quotes, which is what turns
 * every other character cmd.exe reads specially back into text (`&`, `|`, `<`, `>`, `^`,
 * `(`, `)`, `=`, `;`, `!`, a backtick and a space).
 *
 * A run of backslashes at the **end** is doubled: the program's own command-line reader
 * (the C runtime) reads `\"` as a quote, so `"C:\dir\"` would lose the quote that closes it
 * and swallow whatever follows.
 */
export function cmdArgument(argument: string): CmdArgument {
  const reason = unableInCmd(argument);
  if (reason !== null) return { ok: false, reason };
  const trailing = /\\+$/.exec(argument)?.[0] ?? "";
  const kept = argument.slice(0, argument.length - trailing.length);
  return { ok: true, text: `"${kept}${trailing}${trailing}"` };
}

/** The answer about starting an argv on Windows: the argv to spawn, or what cannot start. */
export type WindowsStart =
  | { argv: string[]; ok: true }
  | { argument: string; ok: false; reason: string };

/**
 * The argv that starts `argv` on Windows: `cmd`, its switches, and **one** quoted command
 * line — `start "" /b` with every argument quoted. A line cmd.exe cannot carry gives
 * `ok: false` with the argument and the reason, and then no argv starts it safely.
 */
export function windowsStart(argv: string[]): WindowsStart {
  // The quotes around the whole line are the pair `/s` strips; the text after them is
  // `start`, never a quote, so cmd's own "first character is a quote" rule cannot apply.
  return cmdLine('start "" /b ', argv);
}

/**
 * The argv that runs `argv` through cmd.exe and waits for it — how a program starts a `.cmd`
 * (npm's `claude.cmd`, say), which is no executable: `cmd`, its switches, and one quoted
 * command line, every argument quoted (`cmdArgument`). `/s` strips exactly the outer pair and
 * runs the rest unchanged, so a first argument that is itself quoted (a path with a space) is
 * kept whole. Spawn it with `windowsVerbatimArguments`.
 */
export function windowsRun(argv: string[]): WindowsStart {
  return cmdLine("", argv);
}

/** `cmd` with its switches and one line: `head`, then every argument of `argv`, quoted. */
function cmdLine(head: string, argv: string[]): WindowsStart {
  if (argv[0] === undefined) {
    return { argument: "", ok: false, reason: "there is no program to start" };
  }
  const quoted: string[] = [];
  for (const argument of argv) {
    const one = cmdArgument(argument);
    if (!one.ok) return { argument, ok: false, reason: one.reason };
    quoted.push(one.text);
  }
  return { argv: [CMD, ...CMD_ARGUMENTS, `"${head}${quoted.join(" ")}"`], ok: true };
}

/** `argument` as one line for a message: a line break or a NUL shown as a space. */
function forMessage(argument: string): string {
  return argument.replace(/[\r\n]/g, " ").replaceAll("\u0000", " ");
}

/**
 * The argv that starts `argv` on `platform` so it outlives the caller: unchanged on Linux
 * and macOS, and behind the `cmd /c start` trampoline on Windows, quoted for cmd.exe
 * (`windowsStart`). Pinned per platform by `detached.test.ts`.
 *
 * On Windows an argument cmd.exe cannot carry gives an **empty** argv: there is nothing to
 * run then, and `startDetached` says why. Never spawn the answer without that check.
 */
export function detachedArgv(platform: NodeJS.Platform, argv: string[]): string[] {
  if (platform !== "win32") return argv;
  const start = windowsStart(argv);
  return start.ok ? start.argv : [];
}

/** Where it runs, what it sees, and where one line goes when it cannot be started. */
export interface DetachedOptions {
  /** The folder it runs in; the caller's when not given. */
  cwd?: string;
  /** Its environment; the caller's when not given. */
  env?: Record<string, string>;
  /** One short line when it could not be started. */
  onError: (message: string) => void;
}

/**
 * Starts it, and returns without waiting for it. Linux and macOS: a detached child, never
 * waited for. Windows: the trampoline (whose own exit is waited for — it returns at once),
 * so the program survives this process. An argument cmd.exe cannot carry is one line through
 * `onError` and nothing runs.
 */
export function startDetached(
  platform: NodeJS.Platform,
  argv: string[],
  options: DetachedOptions,
): void {
  const [file, ...args] = argv;
  if (file === undefined) return;
  const where = {
    ...(options.cwd !== undefined && { cwd: options.cwd }),
    ...(options.env !== undefined && { env: options.env }),
  };
  try {
    if (platform === "win32") {
      const start = windowsStart(argv);
      if (!start.ok) {
        options.onError(
          `cannot run "${forMessage(start.argument)}" through cmd.exe: ${start.reason}; nothing was started`,
        );
        return;
      }
      const result = Bun.spawnSync(start.argv, {
        ...where,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        // No console window for `cmd`, and none for the program it starts.
        windowsHide: true,
        // The line is already quoted for cmd.exe (`windowsStart`): the spawner must not
        // quote or escape it a second time.
        windowsVerbatimArguments: true,
      });
      const exitCode = result.exitCode ?? 1;
      if (exitCode !== 0) options.onError(`cmd /d /s /c start failed (exit ${exitCode})`);
      return;
    }
    const child = spawn(file, args, { ...where, detached: true, stdio: "ignore" });
    child.on("error", (error) => options.onError(error.message));
    child.unref();
  } catch (error) {
    options.onError(error instanceof Error ? error.message : String(error));
  }
}
