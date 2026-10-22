/**
 * What the terminal a command prints to can do. One answer, read once per command, and passed
 * to `out.ts`: nothing else in the CLI looks at `isTTY`, `NO_COLOR` or the width.
 *
 * - **rich** — a person is watching a terminal: stdout is a TTY and `TERM` is not `dumb`. Then
 *   a slow step shows progress, and lines wrap to the width.
 * - **plain** — anything else (a pipe, a file, CI, the installers): the same words, with no
 *   colour, no progress line and no wrapping, so a log or a `grep` reads exactly what a person
 *   would have read.
 * - **color** — only when rich, and `NO_COLOR` is not set to a value (no-color.org: "present
 *   and not an empty string"), and the console is not an old Windows one.
 * - **unicode** — the marks ✓ ✗ · and the dashes and arrows in the text. An old Windows console
 *   (cmd or Windows PowerShell in conhost, which may not be UTF-8) gets ASCII instead: there,
 *   `WT_SESSION` (Windows Terminal) or `TERM_PROGRAM=vscode` (VS Code's terminal) says the
 *   console is a new one. Plain output keeps Unicode on every system: its bytes are UTF-8 and a
 *   program reads them (the installers read `doctor --json`), so a log is the same everywhere.
 *   Not proved on a real Windows console yet.
 * - **width** — the columns to wrap to when rich: the terminal's own, at most `MAX_WIDTH`, and
 *   `DEFAULT_WIDTH` when the terminal does not say. Plain output is never wrapped.
 */

/** Lines wrap at this many columns at most, even on a wider terminal: long lines are hard to read. */
export const MAX_WIDTH = 100;
/** The width when a terminal does not say its own. */
export const DEFAULT_WIDTH = 80;
/** No terminal is narrower than this for our wrapping: below it, words would stand one per line. */
const MIN_WIDTH = 40;

export interface Terminal {
  rich: boolean;
  color: boolean;
  unicode: boolean;
  /** The columns to wrap to; `Infinity` for plain output, which is never wrapped. */
  width: number;
}

/** The facts the answer is made from. A test passes its own; `currentTerminal` reads the real ones. */
export interface TerminalFacts {
  isTTY: boolean;
  /** The terminal's columns, when it says. */
  columns?: number | undefined;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}

/** True on a Windows console that may not show UTF-8 or colour: no Windows Terminal, no VS Code. */
function oldWindowsConsole(facts: TerminalFacts): boolean {
  if (facts.platform !== "win32") return false;
  return (facts.env.WT_SESSION ?? "") === "" && facts.env.TERM_PROGRAM !== "vscode";
}

export function detectTerminal(facts: TerminalFacts): Terminal {
  const rich = facts.isTTY && facts.env.TERM !== "dumb";
  const oldConsole = oldWindowsConsole(facts);
  const noColor = (facts.env.NO_COLOR ?? "") !== "";
  const columns = facts.columns !== undefined && facts.columns > 0 ? facts.columns : DEFAULT_WIDTH;
  return {
    rich,
    color: rich && !noColor && !oldConsole,
    unicode: !(rich && oldConsole),
    width: rich ? Math.max(MIN_WIDTH, Math.min(columns, MAX_WIDTH)) : Number.POSITIVE_INFINITY,
  };
}

/**
 * The terminal of this process's stdout. `platform` is the host's own unless a caller has its
 * own answer (setup's `Machine`, which a test fakes).
 */
export function currentTerminal(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): Terminal {
  return detectTerminal({
    isTTY: process.stdout.isTTY === true,
    columns: process.stdout.columns,
    env,
    platform,
  });
}
