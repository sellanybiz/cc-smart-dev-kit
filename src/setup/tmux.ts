/**
 * tmux and the alerts: the one line anymodel manages in the person's `~/.tmux.conf`.
 *
 * A program in a tmux pane cannot write to the terminal beyond tmux with a plain escape
 * sequence: tmux parses it itself and drops it. It reaches the outer terminal only inside
 * tmux's passthrough wrapper (`ESC Ptmux; … ESC \`), and only while the `allow-passthrough`
 * option allows it — `all`, so an alert from a window the person is not looking at arrives
 * too (`on` passes it through only while the pane is visible; owner, 2026-10-16). tmux 3.3
 * or newer has the option; on older tmux there is none to set.
 *
 * So `anymodel setup` writes this line when tmux is installed (only then), keeps the
 * person's own lines and order, and never touches a running server itself: when one is
 * running, setup prints the `tmux set -g …` command to apply it now. `restore` takes the
 * line out again (`applyManagedLine` remembers exactly what it added).
 *
 * The alert itself: `src/hooks/notify.ts` (`forTerminal`).
 */
import { readFileSync } from "node:fs";
import type { Runner } from "../gateway/service";
import { applyManagedLine, type ManagedLineResult } from "./managed-line";

/** The line setup adds to `~/.tmux.conf`: passthrough from every window, not only the visible one. */
export const TMUX_LINE = "set -g allow-passthrough all";

/** What applies the line to a running server (setup prints it; it never runs it). */
export const TMUX_NOW_COMMAND = "tmux set -g allow-passthrough all";

/** The shortest tmux with `allow-passthrough`; older tmux has no such option. */
export const TMUX_MIN_VERSION = "3.3";

/** True when the file holds the managed line. */
export function tmuxLineIn(file: string): boolean {
  try {
    return readFileSync(file, "utf8").split("\n").includes(TMUX_LINE);
  } catch {
    // No file, or one that cannot be read: the line is not there.
    return false;
  }
}

/** Puts the managed line at the end of `~/.tmux.conf`, when it is not there already. */
export function applyTmuxLine(options: {
  dryRun?: boolean;
  file: string;
  stateDir: string;
}): ManagedLineResult {
  return applyManagedLine({ ...options, line: TMUX_LINE });
}

/**
 * `restore` takes the line out through `removeManagedLines` and the lines recorded in
 * `changed.json` (the generic `file-line` path), so no tmux-specific removal lives here: a
 * line the person wrote themselves was never claimed and stays.
 */

/** True when a tmux server answers on this machine's default socket. */
export function tmuxServerRunning(run: Runner): boolean {
  try {
    return run(["tmux", "list-sessions"]).exitCode === 0;
  } catch {
    // No tmux command on PATH: no server either.
    return false;
  }
}

/** The running server's `allow-passthrough` (`all`, `on`, `off`); null when it cannot be read. */
export function tmuxPassthroughOf(run: Runner): null | string {
  try {
    const result = run(["tmux", "show-options", "-gv", "allow-passthrough"]);
    if (result.exitCode !== 0) return null;
    const value = result.output.trim();
    return value === "" ? null : value;
  } catch {
    // No tmux command, or no server: nothing to read.
    return null;
  }
}
