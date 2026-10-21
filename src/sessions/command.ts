/**
 * `cc-smart-dev-kit sessions` — get your Claude Code sessions back, by name.
 *
 * WHY THIS EXISTS
 *   A power cut closes every terminal tab and every running Claude. The sessions themselves
 *   are not lost — Claude Code saves each one to disk as it goes, and `claude --resume <id>`
 *   brings it back — but nothing told you which ids, or in which folder to start them. Warp's
 *   own "restore tabs" is saved when you QUIT Warp, so after a power cut it brings back an
 *   old layout, and never a running Claude.
 *
 * WHAT IT DOES
 *   cc-smart-dev-kit sessions           lists this project's sessions of the last two days,
 *                                       by name and worktree, and saves one Warp tab for
 *                                       each — in Warp's "+" menu as "Claude · <name>".
 *                                       Opening one starts in the main checkout and resumes
 *                                       that session.
 *   cc-smart-dev-kit sessions --open    after a restart, a shutdown, a power cut or a closed
 *                                       window: also opens every session that was open then
 *                                       and nobody has resumed yet — in Warp, or in XFCE
 *                                       Terminal on Linux.
 *   --dry-run with --open               says what it would open, opens nothing.
 *
 *   A power cut KILLS a session: its file never gets Claude Code's end marker. A clean
 *   shutdown CLOSES it, writing the same marker as /exit; a closed terminal window does the
 *   same. The sign is time: several sessions that closed in the same moment before the
 *   machine started were closed by the shutdown, and several that closed together since it
 *   started were closed with one window. One session alone cannot be told from one closed
 *   with /exit.
 *
 * Everything is read from Claude Code's own files; nothing is tracked on the side. The
 * project is found from the working folder: its main checkout, whose own sessions are listed,
 * and every session in a worktree under `<main checkout>/.claude/worktrees/` with them.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { CliPaths } from "../cli/paths";
import { liveSessions } from "../hooks/sessions";
import { openUrlCandidates } from "../machine/open-url";
import { locateCheckout } from "../project/resolve";
import { atomicWrite } from "../setup/write";
import {
  belongsToRepo,
  closedWithWindow,
  describeSession,
  desktopLaunch,
  isSessionId,
  pickReopenTerminal,
  type SavedSession,
  sessionLabel,
  sessionsToReopen,
  stoppedByRestart,
  TAB_CONFIG_MARK,
  tabConfigName,
  warpTabConfig,
  windowsTerminalCommand,
  xfceTerminalCommand,
} from "./saved-sessions";

/** A session used in the last two days keeps its saved tab. */
const PIN_HOURS = 48;
/** `--open` brings back sessions that were in use this long before the machine started. */
const RESTORE_HOURS = 12;
/** Claude Code repeats a session's name and folder all through its file. */
const TAIL_BYTES = 512 * 1024;
/** The one saved tab that is not a session: it runs `--open` for you. */
const RESTORE_ALL = "claude_restore_all";

/** Where Warp keeps its saved tabs, by platform. */
export function warpTabConfigDir(home: string, on: NodeJS.Platform = platform()): string {
  if (on === "win32")
    return join(home, "AppData", "Roaming", "warp", "Warp", "data", "tab_configs");
  if (on === "darwin") return join(home, ".warp", "tab_configs");
  return join(home, ".local", "share", "warp-terminal", "tab_configs");
}

function readTail(path: string, size: number): string {
  const start = Math.max(0, size - TAIL_BYTES);
  const buffer = Buffer.alloc(size - start);
  const file = openSync(path, "r");
  try {
    readSync(file, buffer, 0, buffer.length, start);
  } finally {
    closeSync(file);
  }
  return buffer.toString("utf8");
}

/** One session file under `projects/<folder>/`: `<id>.jsonl`. */
interface SessionFile {
  id: string;
  path: string;
  /** When it was last written, in milliseconds. */
  lastWrite: number;
  size: number;
}

/** One project folder's session files, newest first; none when the folder cannot be read. */
function sessionFiles(projectsDir: string, folder: string): SessionFile[] {
  let names: string[];
  try {
    names = readdirSync(join(projectsDir, folder));
  } catch {
    // Not a folder, or gone since the listing.
    return [];
  }
  const files: SessionFile[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(projectsDir, folder, name);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (stat === undefined || !stat.isFile()) continue;
    files.push({
      id: name.slice(0, -".jsonl".length),
      lastWrite: stat.mtimeMs,
      path,
      size: stat.size,
    });
  }
  return files.sort((a, b) => b.lastWrite - a.lastWrite);
}

/** What one session file's end says (`describeSession`). */
function readSession(file: SessionFile): SavedSession {
  return describeSession(readTail(file.path, file.size), {
    id: file.id,
    lastWrite: file.lastWrite,
  });
}

/**
 * Every folder Claude Code's saved sessions name, once each: the folder the newest session of
 * each project folder last worked in. One tail per project folder, so a machine with thousands
 * of sessions reads one file per folder. `setup` and `update` read it to find the repos the
 * person works in (`src/update/retired-repos.ts`).
 */
export function sessionWorkFolders(projectsDir: string): string[] {
  if (!existsSync(projectsDir)) return [];
  const folders = new Set<string>();
  for (const folder of readdirSync(projectsDir)) {
    const newest = sessionFiles(projectsDir, folder)[0];
    if (newest === undefined) continue;
    const worked = readSession(newest).folder;
    if (worked !== null) folders.add(worked);
  }
  return [...folders];
}

/** This project's sessions written since `since`, newest first. */
export function savedSessions(
  projectsDir: string,
  mainCheckout: string,
  prefix: null | string,
  since: number,
): SavedSession[] {
  if (!existsSync(projectsDir)) return [];
  const sessions: SavedSession[] = [];
  for (const folder of readdirSync(projectsDir)) {
    if (!belongsToRepo(folder, mainCheckout, prefix)) continue;
    for (const file of sessionFiles(projectsDir, folder)) {
      if (file.lastWrite < since) continue;
      const session = readSession(file);
      // A session Claude never titled is a one-shot run (`claude -p`), not one to come back to.
      // The id must be a session id (letters, digits and dashes): it goes into a shell command
      // (`warpTabConfig`, xfceTerminalCommand) and names `--open`'s marker file, and a file
      // name on disk is not a promise about its content.
      if (session.name !== null && isSessionId(session.id)) sessions.push(session);
    }
  }
  return sessions.sort((a, b) => b.lastWrite - a.lastWrite);
}

/** Write a tab for every session, and remove the tabs this command wrote for sessions gone quiet. */
export function saveWarpTabs(
  dir: string,
  sessions: SavedSession[],
  mainCheckout: string,
  command: string,
): void {
  mkdirSync(dir, { recursive: true });
  const keep = new Set([RESTORE_ALL, ...sessions.map((session) => tabConfigName(session))]);
  for (const name of readdirSync(dir)) {
    if (!name.startsWith("claude_") || !name.endsWith(".toml")) continue;
    if (keep.has(name.slice(0, -".toml".length))) continue;
    const path = join(dir, name);
    if (readFileSync(path, "utf8").startsWith(TAB_CONFIG_MARK)) rmSync(path);
  }
  for (const session of sessions) {
    writeFileSync(
      join(dir, `${tabConfigName(session)}.toml`),
      warpTabConfig(session, mainCheckout),
    );
  }
  writeFileSync(
    join(dir, `${RESTORE_ALL}.toml`),
    [
      TAB_CONFIG_MARK,
      'name = "Claude · bring back the sessions a restart or a closed window stopped"',
      'title = "restore Claude sessions"',
      "",
      "[[panes]]",
      'id = "main"',
      'type = "terminal"',
      `directory = ${JSON.stringify(mainCheckout)}`,
      `commands = [${JSON.stringify(`${command} sessions --open`)}]`,
      "",
    ].join("\n"),
  );
}

/** Up to this long a Warp link waits for the Warp the first one started to come up. */
const HANDOVER_MS = 3000;

/**
 * How long after `--open` opened a session another run leaves it alone. A resumed session
 * takes a moment to write to its own file — and to appear in Claude Code's running-session
 * records — so a second `--open` right after the first would open a second copy of it.
 */
export const OPENED_AGAIN_MINUTES = 5;

/** Where `--open` records what it opened: `<stateDir>/sessions-opened/<session id>`. */
export function openedMarkerFile(stateDir: string, id: string): string {
  return join(stateDir, "sessions-opened", id);
}

/**
 * Did `--open` open this session in the last `minutes`? The marker holds the time it was
 * opened; one that does not read, or is older than the window, does not count.
 */
export function openedRecently(
  stateDir: string,
  id: string,
  now: number,
  minutes = OPENED_AGAIN_MINUTES,
): boolean {
  const file = openedMarkerFile(stateDir, id);
  if (!existsSync(file)) return false;
  let text: string;
  try {
    text = readFileSync(file, "utf8").trim();
  } catch {
    // A marker that cannot be read is no proof of anything: open the session.
    return false;
  }
  const at = Date.parse(text);
  return !Number.isNaN(at) && now - at < minutes * 60_000;
}

/** Record that `--open` opened this session, so a quick second run skips it. */
export function markOpened(stateDir: string, id: string, now: number): void {
  atomicWrite(openedMarkerFile(stateDir, id), `${new Date(now).toISOString()}\n`, 0o600);
  // The markers are short-lived: this session's old one was just replaced, and another
  // session's is past its window by now. Removing them keeps one small file per session
  // opened in the last few minutes, and nothing for good.
  const dir = dirname(openedMarkerFile(stateDir, id));
  for (const name of readdirSync(dir)) {
    if (name === id || openedRecently(stateDir, name, now)) continue;
    rmSync(join(dir, name), { force: true });
  }
}

export interface SessionsDeps {
  /** Runs a command and says whether it worked; the opener never reads a terminal. */
  spawnDetached: (argv: string[]) => { exited: Promise<number> };
  which: (command: string) => null | string;
  sleep: (ms: number) => Promise<void>;
  /** The command a person runs (the launcher), for the "run this again" lines. */
  command: string;
  now: number;
  platform: NodeJS.Platform;
  uptimeSeconds: number;
}

/**
 * Opens one window on the Linux desktop — an XFCE Terminal window, or a Warp tab; says
 * whether it opened.
 *
 * Through `systemd-run --user` where there is one (`desktopLaunch`): the window then takes
 * the desktop session's environment, not this command's — which may come from an editor or a
 * Claude session — and it opens on the desktop even when this runs over SSH.
 *
 * Both openers hand the new window to the program already running and exit (an
 * `xfce4-terminal` at once, `xdg-open` with a `warp://` link once Warp passes it on); with
 * none running, the command BECOMES the terminal and runs until its last window closes. So a
 * command still running after `HANDOVER_MS` is showing the window, and one that exits 0
 * handed it over.
 */
async function openOnDesktop(
  command: string[],
  options: { outlivesCommand: boolean },
  deps: SessionsDeps,
): Promise<boolean> {
  const launch = desktopLaunch(command, {
    outlivesCommand: options.outlivesCommand,
    systemdRun: deps.which("systemd-run") !== null,
  });
  const child = deps.spawnDetached(launch);
  const outcome = await Promise.race([child.exited, deps.sleep(HANDOVER_MS).then(() => "showing")]);
  return outcome === "showing" || outcome === 0;
}

function clock(time: number): string {
  return new Date(time).toLocaleString("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

export interface SessionsOptions {
  /** `--open`: reopen the sessions a restart or a closed window stopped. */
  open: boolean;
  /** `--dry-run`: with `--open`, says what it would open and opens nothing. */
  dryRun: boolean;
}

/**
 * The sessions command. `cwd` is the folder it runs in; the project (its worktrees included)
 * comes from there.
 */
export async function runSessions(
  paths: CliPaths,
  options: SessionsOptions,
  deps: SessionsDeps,
  cwd: string = process.cwd(),
): Promise<number> {
  // The main checkout, so a run inside a worktree still lists every session of the project.
  let mainCheckout = resolve(cwd);
  try {
    const checkout = locateCheckout(cwd, { env: process.env });
    if (checkout !== null) mainCheckout = checkout.mainCheckout ?? checkout.root;
  } catch {
    // Outside git, or a main checkout git cannot find: the folder itself is the project.
  }

  const projectsDir = paths.projectsDir;
  const machineStartedAt = deps.now - deps.uptimeSeconds * 1000;
  const sessions = savedSessions(
    projectsDir,
    mainCheckout,
    // The retired engine's `worktrees.prefix` named its folders beside the repo; no project
    // file holds one now, so only `.claude/worktrees/` counts.
    null,
    deps.now - PIN_HOURS * 3_600_000,
  );

  /**
   * The sessions running right now, from Claude Code's own records. A resumed session may not
   * have written to its file yet, and opening it would start a second copy. Null when a
   * running session's record does not read: then nothing is opened.
   */
  function openNow(): null | Set<string> {
    try {
      return new Set(liveSessions(paths.claudeConfigDir).map((session) => session.sessionId));
    } catch {
      return null;
    }
  }
  const running = openNow();
  // A session this command opened a moment ago is left out: it is running now, or starting,
  // and opening it again starts a second copy of it.
  const toOpen =
    running === null
      ? []
      : sessionsToReopen(sessions, running, machineStartedAt, RESTORE_HOURS).filter(
          (session) => !openedRecently(paths.stateDir, session.id, deps.now),
        );
  const withWindow = new Set(
    running === null
      ? []
      : closedWithWindow(
          sessions.filter((session) => !running.has(session.id)),
          machineStartedAt,
        ),
  );
  const stopped = new Set(
    running === null
      ? []
      : stoppedByRestart(
          sessions.filter((session) => !running.has(session.id)),
          machineStartedAt,
          RESTORE_HOURS,
        ),
  );

  if (sessions.length === 0) {
    console.log(
      `No Claude session of this project was used in the last ${String(PIN_HOURS)} hours.`,
    );
    return 0;
  }

  function stateOf(session: SavedSession): string {
    if (running?.has(session.id) === true) return "open now";
    if (withWindow.has(session)) return "CLOSED with its window — not resumed yet";
    if (session.lastWrite >= machineStartedAt) return "used since this machine started";
    if (stopped.has(session)) {
      return session.endedCleanly
        ? "CLOSED by the shutdown — not resumed yet"
        : "STOPPED by the restart — not resumed yet";
    }
    return session.endedCleanly ? "closed" : "not closed cleanly, a while ago";
  }

  console.log(`Claude sessions of this project, used in the last ${String(PIN_HOURS)} hours\n`);
  for (const session of sessions) {
    console.log(`  ${sessionLabel(session)}`);
    console.log(`      last used ${clock(session.lastWrite)} · ${stateOf(session)}`);
    console.log(`      claude --resume ${session.id}     (run it in ${mainCheckout})\n`);
  }

  const tabDir = warpTabConfigDir(paths.home, deps.platform);
  const reopenIn = pickReopenTerminal({
    hasProgram: (name) => deps.which(name) !== null,
    platform: deps.platform,
    warpDataFolder: existsSync(dirname(tabDir)),
  });
  if (reopenIn === "warp") {
    // Saved even before Warp's first start (saveWarpTabs makes the folder).
    saveWarpTabs(tabDir, sessions, mainCheckout, deps.command);
    console.log(
      `Saved a Warp tab for each: the "+" menu → "Claude · <name>". They are in\n${tabDir}\n`,
    );
  } else if (reopenIn === "xfce-terminal") {
    console.log("--open reopens the stopped ones, each in an XFCE Terminal window of its own.\n");
  } else if (reopenIn === "windows-terminal") {
    console.log("--open reopens the stopped ones, each in a Windows Terminal window of its own.\n");
  } else {
    console.log("Warp is not installed here, so no tabs were saved — use the commands above.\n");
  }

  if (!options.open) {
    if (toOpen.length > 0) {
      console.log(
        `${String(toOpen.length)} session(s) were open when the machine went down or their window closed. Bring them back: ${deps.command} sessions --open`,
      );
    }
    return 0;
  }
  if (running === null) {
    console.log(
      "Opened nothing: a running Claude session's record could not be read, so it is unknown which sessions are open now.",
    );
    return 0;
  }
  if (toOpen.length === 0) {
    console.log(
      "Nothing to bring back: no session was open when the machine last went down or when a window closed, or each one is open again.",
    );
    return 0;
  }
  if (reopenIn === "nowhere" || options.dryRun) {
    console.log(`Would open ${String(toOpen.length)} session(s):`);
    for (const session of toOpen) console.log(`  ${sessionLabel(session)}`);
    return 0;
  }

  let failed = false;
  let warpLinks = 0;
  for (const session of toOpen) {
    let opened: boolean;
    if (reopenIn === "warp") {
      const link = `warp://tab_config/${tabConfigName(session)}`;
      // Which program opens a link, per platform: `open-url.ts` (the portal uses the same
      // one). The first candidate is this platform's opener for a desktop link.
      const opener = openUrlCandidates(deps.platform, link)[0];
      opened = await openOnDesktop(opener, { outlivesCommand: true }, deps);
      // Warp takes one link at a time; two in the same instant open one tab. The first link
      // may have to start Warp itself, so the wait after it is the longer one.
      warpLinks += 1;
      await deps.sleep(warpLinks === 1 ? 2000 : 700);
      if (warpLinks === 1 && !opened) {
        console.log(
          "  (Warp may still be starting: the next sessions may not open — run this again if some are missing.)",
        );
      }
    } else {
      const argv =
        reopenIn === "windows-terminal"
          ? windowsTerminalCommand(session, mainCheckout)
          : xfceTerminalCommand(session, mainCheckout);
      opened = argv !== null && (await openOnDesktop(argv, { outlivesCommand: false }, deps));
    }
    failed ||= !opened;
    // Only what really opened is marked: a failed window has to be openable again right away.
    if (opened) markOpened(paths.stateDir, session.id, deps.now);
    console.log(`${opened ? "Opened" : "Could NOT open"}: ${sessionLabel(session)}`);
  }
  if (failed) {
    console.log(
      "Run this in a terminal on the desktop, or start each one with its `claude --resume` line above.",
    );
  }
  return 0;
}
