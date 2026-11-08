/** Lists saved sessions and reopens stopped sessions in a supported terminal. */
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CliPaths } from "../cli/paths";
import { createOut } from "../cli/ui/out";
import { terminalPrompts } from "../cli/ui/prompt";
import { currentTerminal } from "../cli/ui/terminal";
import { liveSessions } from "../hooks/sessions";
import { callClaude, findClaude } from "../machine/claude";
import { locateCheckout } from "../project/resolve";
import { atomicWrite } from "../setup/write";
import {
  FINISHED_SESSION_AGE_MS,
  readFinishedSessions,
  readSessionAgents,
  type SessionAgentRow,
  sessionsClaudeDeps,
} from "./finished";
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
  windowsTerminalCommand,
  xfceTerminalCommand,
} from "./saved-sessions";

/** A session used in the last two days keeps its saved tab. */
const PIN_HOURS = 48;
/** `--open` brings back sessions that were in use this long before the machine started. */
const RESTORE_HOURS = 12;
/** Claude Code repeats a session's name and folder all through its file. */
const TAIL_BYTES = 512 * 1024;

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
 * Every folder Claude Code's saved sessions name, once each, with the newest time one of its
 * session records was written: the folder the newest session of each project folder last
 * worked in. One tail per project folder, so a machine with thousands of sessions reads one
 * file per folder. A project folder whose newest session names no folder is left out, and a
 * folder two project folders name once keeps the newer time.
 *
 * `setup` and `update` read the folders (`sessionWorkFolders`) to find the repos the person
 * works in (`src/update/retired-repos.ts`); the portal's Projects page reads the times too.
 */
export function sessionWorkFolderTimes(
  projectsDir: string,
): { folder: string; lastWrite: number }[] {
  if (!existsSync(projectsDir)) return [];
  const folders = new Map<string, number>();
  for (const folder of readdirSync(projectsDir)) {
    const newest = sessionFiles(projectsDir, folder)[0];
    if (newest === undefined) continue;
    const worked = readSession(newest).folder;
    if (worked === null) continue;
    folders.set(worked, Math.max(folders.get(worked) ?? 0, newest.lastWrite));
  }
  return [...folders].map(([folder, lastWrite]) => ({ folder, lastWrite }));
}

/**
 * Every folder Claude Code's saved sessions name, once each (the folders of
 * `sessionWorkFolderTimes`, without their times).
 */
export function sessionWorkFolders(projectsDir: string): string[] {
  return sessionWorkFolderTimes(projectsDir).map((worked) => worked.folder);
}

/** This project's sessions written since `since`, newest first. */
export function savedSessions(
  projectsDir: string,
  mainCheckout: string,
  since: number,
): SavedSession[] {
  if (!existsSync(projectsDir)) return [];
  const sessions: SavedSession[] = [];
  for (const folder of readdirSync(projectsDir)) {
    if (!belongsToRepo(folder, mainCheckout)) continue;
    for (const file of sessionFiles(projectsDir, folder)) {
      if (file.lastWrite < since) continue;
      const session = readSession(file);
      // A session Claude never titled is a one-shot run (`claude -p`), not one to come back to.
      // The id must be a session id (letters, digits and dashes): it goes into a shell command
      // (`xfceTerminalCommand`) and names `--open`'s marker file, and a file
      // name on disk is not a promise about its content.
      if (session.name !== null && isSessionId(session.id)) sessions.push(session);
    }
  }
  return sessions.sort((a, b) => b.lastWrite - a.lastWrite);
}

/** Time allowed for the terminal to hand a window to an existing process. */
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
  agents?: () => null | SessionAgentRow[];
  confirm?: (question: string) => boolean;
  runClaude?: (args: string[]) => number;
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

/** Opens a terminal window and waits for its launch or handover result. */
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
  /** `--open`: reopen sessions stopped by restart/window close. */
  open: boolean;
  /** `--dry-run`: with `--open`, says what it would open and opens nothing. */
  dryRun: boolean;
  finished?: boolean;
  /** Limit --finished --remove to these exact short ids. */
  ids?: string[];
  remove?: boolean;
  yes?: boolean;
}

/** The finished background sessions: listed, and with `--remove` removed by `claude rm`. The exit code. */
function finishedPart(
  paths: CliPaths,
  options: SessionsOptions,
  deps: SessionsDeps,
  cwd: string,
  out: ReturnType<typeof createOut>,
  term: ReturnType<typeof currentTerminal>,
): number {
  const context = sessionsClaudeDeps(paths, deps.platform, deps.which);
  const agents = deps.agents ?? (() => readSessionAgents(context, cwd));
  const read = () => readFinishedSessions(paths, { agents, now: deps.now });
  const initial = read();
  if (initial.error !== null) {
    out.line("fail", initial.error);
    return 1;
  }
  const requested = new Set(options.ids ?? []);
  if ([...requested].some((id) => !initial.sessions.some((row) => row.id === id))) {
    out.line(
      "fail",
      "A named session is not an eligible finished session. Read sessions --finished again; nothing removed.",
    );
    return 1;
  }
  const sessions =
    requested.size === 0
      ? initial.sessions
      : initial.sessions.filter((row) => requested.has(row.id));
  if (sessions.length === 0) {
    out.line("info", "No finished background sessions older than one day.");
    return 0;
  }
  out.heading("Finished background sessions older than one day");
  for (const row of sessions)
    out.line("info", `${row.name} — ${row.folder} — ${finishedAge(row.ageMs)}`);
  if (!options.remove) return 0;
  if (!options.yes) {
    const confirm =
      deps.confirm ?? ((question: string) => terminalPrompts(term)?.confirm(question) ?? false);
    if (
      !confirm(
        `Remove these ${sessions.length} finished sessions with claude rm? A registered or locked worktree must be cleared first.`,
      )
    ) {
      out.line(
        "info",
        `Nothing removed. Use ${deps.command} sessions --finished --remove --yes to confirm without a terminal.`,
      );
      return 0;
    }
  }
  let removed = 0;
  let failed = false;
  for (const row of sessions) {
    // The person may resume a session while the question is open.
    // Re-read agent view, role records and the terminal timestamp immediately before each rm.
    const current = read();
    if (current.error !== null) {
      out.line("fail", current.error);
      return 1;
    }
    if (!current.sessions.some((one) => one.id === row.id && one.sessionId === row.sessionId)) {
      out.line("info", `Kept ${row.name}: it is no longer an eligible finished session.`);
      continue;
    }
    const result =
      deps.runClaude === undefined
        ? (() => {
            const binary = findClaude(context);
            if (binary === null) return { code: 1, detail: "claude is not on PATH" };
            const called = callClaude(context, binary, ["rm", row.id], cwd);
            if (!called.ok) return { code: 1, detail: called.why };
            const output = [called.run.stderr.trim(), called.run.stdout.trim()]
              .filter((line) => line !== "")
              .join("\n");
            return {
              code: called.run.timedOut ? 1 : (called.run.exitCode ?? 1),
              detail: [called.run.timedOut ? "claude rm timed out" : "", output]
                .filter((line) => line !== "")
                .join("\n"),
            };
          })()
        : { code: deps.runClaude(["rm", row.id]), detail: "" };
    if (result.code !== 0) {
      out.line(
        "fail",
        `Could not remove ${row.name} (${row.id}, exit ${result.code})${result.detail === "" ? "." : `: ${result.detail}`}`,
        {
          fix: `Check claude agents --json --all. Clear a registered or locked worktree with ${deps.command} worktrees --clean from its repository's main checkout, or ExitWorktree, then retry ${deps.command} sessions --finished --remove.`,
        },
      );
      failed = true;
      continue;
    }
    removed++;
  }
  out.line("info", `Removed ${removed} finished session(s).`);
  return failed ? 1 : 0;
}

function finishedAge(ms: number): string {
  const days = Math.floor(ms / FINISHED_SESSION_AGE_MS);
  const hours = Math.floor((ms % FINISHED_SESSION_AGE_MS) / 3_600_000);
  return `${days}d ${hours}h ago`;
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
  if (
    ((options.ids?.length ?? 0) > 0 && (!options.finished || !options.remove)) ||
    (options.ids?.some((id) => !/^[0-9a-f]{8}$/.test(id)) ?? false) ||
    (options.remove && !options.finished) ||
    (options.yes && !options.remove) ||
    (options.finished && (options.open || options.dryRun))
  ) {
    console.error(
      "Use sessions --finished [--remove [--yes]] separately from --open and --dry-run.",
    );
    return 2;
  }
  if (options.finished) {
    const term = currentTerminal(process.env);
    return finishedPart(paths, options, deps, resolve(cwd), createOut(term), term);
  }
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
  const sessions = savedSessions(projectsDir, mainCheckout, deps.now - PIN_HOURS * 3_600_000);

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

  const reopenIn = pickReopenTerminal({
    hasProgram: (name) => deps.which(name) !== null,
    platform: deps.platform,
  });
  if (reopenIn === "xfce-terminal") {
    console.log("--open reopens the stopped ones, each in an XFCE Terminal window of its own.\n");
  } else if (reopenIn === "windows-terminal") {
    console.log("--open reopens the stopped ones, each in a Windows Terminal window of its own.\n");
  } else {
    console.log("No supported terminal is installed here — use the commands above.\n");
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
  for (const session of toOpen) {
    const argv =
      reopenIn === "windows-terminal"
        ? windowsTerminalCommand(session, mainCheckout)
        : xfceTerminalCommand(session, mainCheckout);
    const opened = argv !== null && (await openOnDesktop(argv, { outlivesCommand: false }, deps));
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
  // A window that did not open is this command's failure, so a script around it can tell
  // that a session did not come back.
  return failed ? 1 : 0;
}
