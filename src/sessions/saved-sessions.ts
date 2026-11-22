/**
 * Reading saved sessions and preparing terminal commands to resume them.
 *
 * Claude Code writes every session to disk as it goes — one `.jsonl` file per session, under
 * `<config folder>/projects/<folder>/`, named by the session's id. The id does not change
 * when a session is resumed. So a power cut loses the terminal tabs and the running
 * programs, never the sessions: `claude --resume <id>` brings one back with its history.
 * What was missing is a quick way to know WHICH ids, and to get them all back in their tabs.
 *
 * Everything here is worked out from those files. Nothing is tracked on the side, so there is
 * nothing to keep in step and nothing a crash can leave half-written.
 *
 * The functions in this file take plain values and touch no disk, so they can be tested.
 * `command.ts` does the reading, the writing and the opening.
 *
 * NOT PORTED from the project this came from: its Windows shutdown log (`wevtutil qe System`,
 * which told a clean shutdown from a power cut). Everywhere, including Windows, the sign is
 * the one that needs no log: several sessions that closed in the same moment before the
 * machine started were closed by the shutdown (`docs/windows-setup.md` says what that costs).
 */

import { worktreesFolder } from "../worktrees/paths";

/** One saved session, as far as its file tells. */
export interface SavedSession {
  /** The branch of the worktree it works in, when it is in one. */
  branch: null | string;
  /**
   * Claude Code closed it itself. It writes a `cost-state` entry as a session ends, so a
   * file that does not end with one belongs to a session that is still running — or was
   * killed (seen in Claude Code 2.1.289; not a documented format).
   */
  endedCleanly: boolean;
  /** The folder it last worked in. */
  folder: null | string;
  id: string;
  /** When its file was last written, in milliseconds. */
  lastWrite: number;
  /**
   * The model that wrote its last reply in the file's tail (`message.model`: an affordable
   * backend's own name when a slot answered); null when the tail holds no reply.
   */
  model: null | string;
  /** The name the person gave it (`/rename`), or else the title Claude gave it. */
  name: null | string;
}

/**
 * A project folder's name is cut at this many characters (seen live, 2.1.310: a path whose name
 * is 200 characters stays whole, one of 201 is cut and given a hash).
 */
const PROJECT_FOLDER_NAME_MAX = 200;

/**
 * Claude Code's hash of a folder's path, in base 36: the 32-bit `hash * 31 + code` over the
 * path's UTF-16 units, as a positive number (seen live, 2.1.310: the suffix of three cut names,
 * `docs/claude-code-contract.md`).
 */
function pathHash(path: string): string {
  let hash = 0;
  for (let index = 0; index < path.length; index += 1) {
    hash = (hash << 5) - hash + path.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * The name Claude Code gives a folder under `projects/`: every character that is not a
 * letter or a digit becomes a dash. `D:\Code\app` and `D:/Code/app` both become `D--Code-app`.
 * A name longer than 200 characters is cut there and ends with `-` and a hash of the folder's
 * whole path (the raw path, not the dashed name), so two long paths that share their first 200
 * characters stay apart.
 */
export function projectFolderName(path: string): string {
  const name = path.replace(/[^A-Za-z0-9]/g, "-");
  return name.length <= PROJECT_FOLDER_NAME_MAX
    ? name
    : `${name.slice(0, PROJECT_FOLDER_NAME_MAX)}-${pathHash(path)}`;
}

/**
 * The ways one folder's path may have been written when Claude Code made its project folder's
 * name. A name over 200 characters carries a hash of the raw path (`projectFolderName`), so the
 * separator and the drive letter's case change it: git prints `C:/work/app`, Claude Code's own
 * cwd is `C:\work\app`, and a lower-case drive letter is a third spelling of the same place.
 */
function pathSpellings(path: string): string[] {
  const separators = [path, path.replaceAll("/", "\\"), path.replaceAll("\\", "/")];
  const spellings = new Set<string>();
  for (const spelled of separators) {
    spellings.add(spelled);
    if (/^[A-Za-z]:/.test(spelled)) {
      const drive = spelled.charAt(0);
      spellings.add(`${drive.toUpperCase()}${spelled.slice(1)}`);
      spellings.add(`${drive.toLowerCase()}${spelled.slice(1)}`);
    }
  }
  return [...spellings];
}

/**
 * The project folder names of the worktrees git lists for a repo, wherever a project's own
 * WorktreeCreate hook put them (`belongsToRepo`). Each path is encoded in every spelling
 * Claude Code may have used (`pathSpellings`). The caller adds the real path of a folder that is
 * reached through a link: this file touches no disk.
 */
export function worktreeProjectFolders(paths: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const path of paths)
    for (const spelled of pathSpellings(path)) names.add(projectFolderName(spelled));
  return names;
}

/**
 * Is this project folder the repo's main checkout, or one of its worktrees? Claude Code makes
 * a session's own worktree inside the repo, `<main checkout>/.claude/worktrees/<name>`, and a
 * session launched with `claude -w <name>` works there. A project's own WorktreeCreate hook may
 * put a worktree anywhere, so a worktree git lists counts by its exact folder
 * (`worktreeProjectFolders`). A folder's parent never counts: worktrees placed beside the repo
 * would claim every sibling project's sessions.
 */
export function belongsToRepo(
  projectFolder: string,
  mainCheckout: string,
  worktrees: ReadonlySet<string> = new Set(),
): boolean {
  const main = projectFolderName(mainCheckout);
  if (projectFolder === main || worktrees.has(projectFolder)) return true;
  // The folder name of a path under `<main>/.claude/worktrees/`, built the same way Claude
  // Code names a project folder: every character that is not a letter or a digit is a dash.
  const claudeOwn = `${projectFolderName(worktreesFolder(mainCheckout))}-`;
  return projectFolder.startsWith(claudeOwn);
}

/**
 * What the END of a session file says about the session. Claude Code repeats the name and
 * the folder all through the file, so the last part of it is enough — a session file can be
 * 90 MB.
 *
 * `tail` may start in the middle of a line; a line that does not parse is skipped.
 */
export function describeSession(
  tail: string,
  file: { id: string; lastWrite: number },
): SavedSession {
  let givenName: null | string = null;
  let title: null | string = null;
  let folder: null | string = null;
  let branch: null | string = null;
  let model: null | string = null;
  const lastTypes: unknown[] = [];

  for (const line of tail.split("\n")) {
    if (line.trim() === "") continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    lastTypes.push(entry.type);
    if (typeof entry.cwd === "string") folder = entry.cwd;
    if (entry.type === "assistant") model = replyModel(entry.message) ?? model;
    if (entry.type === "agent-name" && typeof entry.agentName === "string") {
      givenName = entry.agentName;
    }
    if (entry.type === "ai-title" && typeof entry.aiTitle === "string") {
      title = entry.aiTitle;
    }
    if (entry.type === "relocated" && typeof entry.relocatedCwd === "string") {
      folder = entry.relocatedCwd;
    }
    if (entry.type === "worktree-state") {
      const worktree = entry.worktreeSession;
      if (typeof worktree === "object" && worktree !== null) {
        const { worktreeBranch, worktreePath } = worktree as Record<string, unknown>;
        if (typeof worktreePath === "string") folder = worktreePath;
        branch = typeof worktreeBranch === "string" ? worktreeBranch : null;
      } else {
        // The session left its worktree.
        branch = null;
      }
    }
  }

  return {
    branch,
    // The end marker is followed by at most a link or two to what continues it.
    endedCleanly: lastTypes.slice(-3).includes("cost-state"),
    folder,
    id: file.id,
    lastWrite: file.lastWrite,
    model,
    name: givenName ?? title,
  };
}

/**
 * The model a reply names; null for none, and for `<synthetic>`: Claude Code's own stand-in
 * for a message it wrote itself (an interrupted turn, an error), which no model answered.
 */
function replyModel(message: unknown): null | string {
  if (typeof message !== "object" || message === null) return null;
  const model = (message as Record<string, unknown>).model;
  return typeof model === "string" && model !== "" && model !== "<synthetic>" ? model : null;
}

/** The last part of a path, whichever slash it uses. */
function lastPart(path: string): string {
  return path.split(/[\\/]/).findLast((part) => part !== "") ?? path;
}

/** What a person recognises a session by: its name, and the worktree it works in. */
export function sessionLabel(session: SavedSession): string {
  const name = session.name ?? `session ${session.id.slice(0, 8)}`;
  return session.folder === null ? name : `${name} — ${lastPart(session.folder)}`;
}

/** A session id Claude Code wrote: letters, digits and dashes only. It goes into a shell command. */
export function isSessionId(id: string): boolean {
  return /^[A-Za-z0-9-]{8,64}$/.test(id);
}

/**
 * The command that opens one session in an XFCE Terminal window of its own — the Linux
 * terminal: in the main checkout, resuming it. A window per session, not
 * a tab, because a click on a Claude Code notification raises a window. A login shell, so
 * `claude` is on PATH; it stays open after Claude exits, for another command. Null for an id
 * that is not a session's — it goes into a shell command.
 */
export function xfceTerminalCommand(session: SavedSession, mainCheckout: string): null | string[] {
  if (!isSessionId(session.id)) return null;
  return [
    "xfce4-terminal",
    "--window",
    // Until Claude titles it "<mark> <name>" itself; "replace", so the window's title is
    // then exactly that (XFCE's default appends it to this one).
    `--initial-title=${session.name ?? sessionLabel(session)}`,
    "--dynamic-title-mode=replace",
    `--working-directory=${mainCheckout}`,
    "--execute",
    "bash",
    "-lc",
    `claude --resume ${session.id}; exec bash -l`,
  ];
}

/**
 * The command that opens one session in a Windows Terminal window of its own — the Windows
 * terminal: in the main checkout,
 * resuming it. `wt.exe` makes a window when the person has none open and a tab in the
 * window they have, which is what a person asking for their sessions back wants. `cmd /k`
 * keeps the window open after Claude exits, for another command. Null for an id that is not a
 * session's — it goes into a command line.
 */
export function windowsTerminalCommand(
  session: SavedSession,
  mainCheckout: string,
): null | string[] {
  if (!isSessionId(session.id)) return null;
  return ["wt.exe", "-d", mainCheckout, "cmd", "/k", `claude --resume ${session.id}`];
}

/** Where `--open` brings sessions back: XFCE Terminal or Windows Terminal windows, or nowhere. */
export type ReopenIn = "nowhere" | "windows-terminal" | "xfce-terminal";

/** Picks a supported terminal from the programs installed on this platform. */
export function pickReopenTerminal(machine: {
  hasProgram: (name: string) => boolean;
  platform: NodeJS.Platform;
}): ReopenIn {
  const linux = machine.platform === "linux";
  const windows = machine.platform === "win32";
  if (linux && machine.hasProgram("xfce4-terminal")) return "xfce-terminal";
  if (windows && machine.hasProgram("wt.exe")) return "windows-terminal";
  return "nowhere";
}

/**
 * The command that opens a window on the Linux desktop: through `systemd-run --user` where
 * there is one, so the window takes the desktop session's environment and opens there even
 * over SSH. `--wait` passes the command's own exit code back. `outlivesCommand`: the program
 * the command starts outlives the command itself — a program that a desktop opener started — so the
 * unit must end only when its whole cgroup does (ExitType=cgroup, systemd 250+); otherwise
 * systemd would stop that program together with the command. Not for XFCE Terminal, whose
 * command IS the terminal or exits at once: there the unit ends with it.
 */
export function desktopLaunch(
  command: string[],
  options: { outlivesCommand: boolean; systemdRun: boolean },
): string[] {
  if (!options.systemdRun) return command;
  return [
    "systemd-run",
    "--user",
    "--wait",
    "--collect",
    "--quiet",
    ...(options.outlivesCommand ? ["--property=ExitType=cgroup"] : []),
    "--",
    ...command,
  ];
}

/**
 * The sessions the machine going down stopped, and that nobody has opened again.
 *
 *   - **Killed** (power cut, crash): not closed by Claude Code itself, last written before
 *     the machine started, and not long before. The time limit is the safety net: should a
 *     later Claude Code stop writing its end marker, every old session would look killed.
 *   - **Closed by a clean shutdown or restart**: Claude Code writes the same end marker as
 *     for /exit, so the marker alone cannot tell. The time can: a shutdown closes every open
 *     session in the same moment, so the newest group of two or more that closed together
 *     before the machine started counts; one session alone looks exactly like /exit and stays
 *     closed.
 *
 * A session written AFTER the start is running, or was resumed already — opening it again
 * would start a second copy of it.
 */
export function stoppedByRestart(
  sessions: SavedSession[],
  machineStartedAt: number,
  withinHours: number,
): SavedSession[] {
  const earliest = machineStartedAt - withinHours * 3_600_000;
  const closedTogether = new Set(
    newestCloseTogether(
      sessions.filter(
        (session) =>
          session.endedCleanly &&
          session.lastWrite < machineStartedAt &&
          session.lastWrite >= earliest,
      ),
    ),
  );
  return sessions.filter((session) => {
    if (session.lastWrite >= machineStartedAt) return false;
    if (!session.endedCleanly) return session.lastWrite >= earliest;
    return closedTogether.has(session);
  });
}

/** Sessions that closed this close together closed with one window. */
const SAME_CLOSE_MS = 5000;

/**
 * The sessions that closed with their terminal window since the machine started — the newest
 * such group, among the sessions nobody has opened again.
 *
 * Closing a window makes Claude Code close each session in it exactly as /exit does: the end
 * marker within 0.1 s of the close (measured in the project this came from, Claude Code
 * 2.1.289). So one session alone cannot be told from one the person closed. Two or more that
 * closed within a few seconds of each other can: a person closes sessions one at a time, a
 * window closes all of its tabs at once.
 */
export function closedWithWindow(
  sessions: SavedSession[],
  machineStartedAt: number,
): SavedSession[] {
  return newestCloseTogether(
    sessions.filter((session) => session.endedCleanly && session.lastWrite >= machineStartedAt),
  );
}

/** The newest group of two or more cleanly ended sessions that closed in the same moment. */
function newestCloseTogether(endedCleanly: SavedSession[]): SavedSession[] {
  const ended = [...endedCleanly].sort((a, b) => a.lastWrite - b.lastWrite);
  let newest: SavedSession[] = [];
  let group: SavedSession[] = [];
  for (const session of ended) {
    const previous = group.at(-1);
    if (previous !== undefined && session.lastWrite - previous.lastWrite > SAME_CLOSE_MS) {
      if (group.length >= 2) newest = group;
      group = [];
    }
    group.push(session);
  }
  return group.length >= 2 ? group : newest;
}

/** The saved sessions that were open when the machine stopped, or when a window closed. */
export function sessionsToReopen(
  sessions: SavedSession[],
  running: Set<string>,
  machineStartedAt: number,
  withinHours: number,
): SavedSession[] {
  const notRunning = sessions.filter((session) => !running.has(session.id));
  const stopped = stoppedByRestart(notRunning, machineStartedAt, withinHours);
  const withWindow = closedWithWindow(notRunning, machineStartedAt);
  return [...stopped, ...withWindow];
}
