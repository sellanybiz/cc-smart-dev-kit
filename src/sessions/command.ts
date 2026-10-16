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
 * project is found from the working folder (`cc-smart-dev-kit.json` `worktrees.prefix` and
 * `worktrees.base`); without that file, only the main checkout's own sessions are listed.
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
import { loadProjectConfig, locateCheckout } from "../project/resolve";
import {
  belongsToRepo,
  closedWithWindow,
  describeSession,
  desktopLaunch,
  pickReopenTerminal,
  type SavedSession,
  sessionLabel,
  sessionsToReopen,
  stoppedByRestart,
  TAB_CONFIG_MARK,
  tabConfigName,
  warpTabConfig,
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

/** This project's sessions written since `since`, newest first. */
export function savedSessions(
  projectsDir: string,
  mainCheckout: string,
  prefix: string,
  since: number,
): SavedSession[] {
  if (!existsSync(projectsDir)) return [];
  const sessions: SavedSession[] = [];
  for (const folder of readdirSync(projectsDir)) {
    if (!belongsToRepo(folder, mainCheckout, prefix)) continue;
    for (const name of readdirSync(join(projectsDir, folder))) {
      if (!name.endsWith(".jsonl")) continue;
      const path = join(projectsDir, folder, name);
      const stat = statSync(path);
      if (!stat.isFile() || stat.mtimeMs < since) continue;
      const session = describeSession(readTail(path, stat.size), {
        id: name.slice(0, -".jsonl".length),
        lastWrite: stat.mtimeMs,
      });
      // A session Claude never titled is a one-shot run (`claude -p`), not one to come back to.
      if (session.name !== null) sessions.push(session);
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
  let prefix = "";
  try {
    const checkout = locateCheckout(cwd, { env: process.env });
    if (checkout !== null) {
      mainCheckout = checkout.mainCheckout ?? checkout.root;
      const project = loadProjectConfig(checkout);
      prefix = project.config?.worktrees?.prefix ?? "";
    }
  } catch {
    // Outside git, or a project file that does not read: the folder itself is the project.
  }

  const projectsDir = join(paths.claudeConfigDir, "projects");
  const machineStartedAt = deps.now - deps.uptimeSeconds * 1000;
  const sessions = savedSessions(
    projectsDir,
    mainCheckout,
    prefix,
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
  const toOpen =
    running === null ? [] : sessionsToReopen(sessions, running, machineStartedAt, RESTORE_HOURS);
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
      const opener =
        deps.platform === "win32"
          ? ["cmd", "/c", "start", "", link]
          : deps.platform === "darwin"
            ? ["open", link]
            : ["xdg-open", link];
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
      const argv = xfceTerminalCommand(session, mainCheckout);
      opened = argv !== null && (await openOnDesktop(argv, { outlivesCommand: false }, deps));
    }
    failed ||= !opened;
    console.log(`${opened ? "Opened" : "Could NOT open"}: ${sessionLabel(session)}`);
  }
  if (failed) {
    console.log(
      "Run this in a terminal on the desktop, or start each one with its `claude --resume` line above.",
    );
  }
  return 0;
}
