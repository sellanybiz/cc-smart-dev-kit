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
import { type CliPaths, tildify } from "../cli/paths";
import { createOut } from "../cli/ui/out";
import { terminalPrompts } from "../cli/ui/prompt";
import { currentTerminal } from "../cli/ui/terminal";
import { readCrewLeftovers, sweepCrewConversations } from "../crew/archive";
import { callClaude, findClaude } from "../crew/claude";
import { type CrewContext, realCrewContext } from "../crew/context";
import { releaseCrewSession } from "../crew/release";
import { liveSessions } from "../hooks/sessions";
import { openUrlCandidates } from "../machine/open-url";
import { locateCheckout } from "../project/resolve";
import { atomicWrite } from "../setup/write";
import { repoKey } from "../workflow/reviews";
import {
  FINISHED_SESSION_AGE_MS,
  readFinishedSessions,
  readSessionAgents,
  releasableCrewSessions,
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
  TAB_CONFIG_MARK,
  tabCheckoutOf,
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
      // (`warpTabConfig`, xfceTerminalCommand) and names `--open`'s marker file, and a file
      // name on disk is not a promise about its content.
      if (session.name !== null && isSessionId(session.id)) sessions.push(session);
    }
  }
  return sessions.sort((a, b) => b.lastWrite - a.lastWrite);
}

/** Every saved tab of this project starts with this, and one of another project never does. */
function tabPrefix(key: string): string {
  return `claude_${key}_`;
}

/**
 * Write a tab for every session, and remove this project's tabs for sessions gone quiet.
 *
 * Only this project's tabs are touched: the name carries the project's key, and a tab
 * written before the key existed is recognized by its own `directory` line. Warp keeps
 * every project's tabs in one folder, so removing "every tab of ours that is not in `keep`"
 * once removed another project's tabs and took over its "bring back the sessions" tab.
 */
export function saveWarpTabs(
  dir: string,
  sessions: SavedSession[],
  mainCheckout: string,
  command: string,
): void {
  mkdirSync(dir, { recursive: true });
  const key = repoKey(mainCheckout);
  const prefix = tabPrefix(key);
  const restoreAll = `${prefix}restore_all`;
  const keep = new Set([restoreAll, ...sessions.map((session) => tabConfigName(key, session))]);
  for (const name of readdirSync(dir)) {
    if (!name.startsWith("claude_") || !name.endsWith(".toml")) continue;
    if (keep.has(name.slice(0, -".toml".length))) continue;
    const path = join(dir, name);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      // Removed between the listing and the look, or not ours to read: nothing to remove.
      continue;
    }
    if (!text.startsWith(TAB_CONFIG_MARK)) continue;
    if (name.startsWith(prefix) || tabCheckoutOf(text) === mainCheckout) rmSync(path);
  }
  for (const session of sessions) {
    writeFileSync(
      join(dir, `${tabConfigName(key, session)}.toml`),
      warpTabConfig(session, mainCheckout),
    );
  }
  writeFileSync(
    join(dir, `${restoreAll}.toml`),
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
  agents?: () => null | SessionAgentRow[];
  /**
   * The context the release of a gone lead's finished crew sessions runs in (D69); default: the
   * real one, with this command's `which`, `platform` and `now`.
   */
  crew?: CrewContext;
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

/**
 * `sessions --finished [--remove]`: the finished background sessions, then what removed crew
 * sessions left in `/resume` (AR1). `--id` names finished sessions only, so it leaves the crew
 * part out.
 */
async function runFinishedSessions(
  paths: CliPaths,
  options: SessionsOptions,
  deps: SessionsDeps,
  cwd: string,
): Promise<number> {
  const term = currentTerminal(process.env);
  const out = createOut(term);
  let releasedCode = 0;
  if ((options.ids?.length ?? 0) === 0) {
    const ctx = deps.crew ?? {
      ...realCrewContext(paths),
      cwd,
      which: deps.which,
      platform: deps.platform,
      now: () => deps.now,
    };
    const records = await releasableCrewSessions(ctx);
    if (records.length > 0) {
      out.heading("Finished crew sessions whose lead is stopped or gone");
      for (const record of records)
        out.line(
          "info",
          `${record.name} — release worktree and agent-view rows; keep branch ${record.branch}`,
        );
      if (
        options.remove &&
        (options.yes ||
          (
            deps.confirm ??
            ((question: string) => terminalPrompts(term)?.confirm(question) ?? false)
          )(
            "Release these crew worktrees and agent-view rows? Their branches and conversations stay.",
          ))
      ) {
        const eligible = new Set((await releasableCrewSessions(ctx)).map((record) => record.id));
        for (const record of records) {
          if (!eligible.has(record.id)) continue;
          const result = await releaseCrewSession(record, ctx);
          if (!result.ok) {
            out.line("info", `Kept ${record.name}: ${result.why}`);
            releasedCode = 1;
          }
        }
      }
    }
  }
  const finished = Math.max(releasedCode, finishedPart(paths, options, deps, cwd, out, term));
  if ((options.ids?.length ?? 0) > 0) return finished;
  const crew = await crewLeftoversPart(paths, options, deps, out, term);
  return Math.max(finished, crew);
}

/** The phrase for a count of a thing: `1 conversation`, `3 conversations`. */
function counted(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** Joins phrases as a person writes them: `a`, `a and b`, `a, b and c`. */
function joined(parts: string[]): string {
  return parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

/**
 * What removed crew sessions left (AR1): their conversations still in `/resume`, the empty
 * project folders of their worktrees, the archives past `crew.archiveDays`. Lists them; with
 * `--remove`, asks once (or `--yes`), reads them again, then moves each conversation into the
 * kit's archive, removes each empty folder and deletes each expired archive. The exit code.
 */
async function crewLeftoversPart(
  paths: CliPaths,
  options: SessionsOptions,
  deps: SessionsDeps,
  out: ReturnType<typeof createOut>,
  term: ReturnType<typeof currentTerminal>,
): Promise<number> {
  const read = () => readCrewLeftovers(paths, { env: process.env, now: deps.now });
  const left = read();
  if (left.error !== null) {
    out.line("fail", left.error);
    return 1;
  }
  const home = paths.home;
  if (left.conversations.length + left.kept.length > 0) {
    out.heading("Conversations of removed crew sessions, still in /resume");
    for (const one of left.conversations)
      out.line(
        "info",
        `${one.record.name} — ${tildify(one.record.worktree, home)} — ${counted(one.files, "file", "files")}`,
      );
    for (const one of left.kept) out.line("info", `${one.record.name} stays: ${one.why}`);
  }
  if (left.emptyFolders.length > 0) {
    out.heading("Empty project folders of removed crew sessions");
    for (const folder of left.emptyFolders) out.line("info", tildify(folder, home));
  }
  if (left.expired.length > 0) {
    out.heading("Archived crew conversations past crew.deleteDays");
    for (const one of left.expired)
      out.line("info", `${one.name} — archived ${finishedAge(one.ageMs)}`);
  }
  for (const one of left.scheduled ?? [])
    out.line("info", `${one.name} — archive deleted ${one.deleteAt}`);
  const plan = [
    left.conversations.length === 0
      ? ""
      : `move ${counted(left.conversations.length, "conversation", "conversations")} out of /resume into the kit's archive`,
    left.emptyFolders.length === 0
      ? ""
      : `remove ${counted(left.emptyFolders.length, "empty project folder", "empty project folders")}`,
    left.expired.length === 0
      ? ""
      : `delete ${counted(left.expired.length, "archive", "archives")} past crew.deleteDays`,
  ].filter((part) => part !== "");
  if (plan.length === 0) {
    if (left.kept.length === 0)
      out.line("info", "No conversations of removed crew sessions are left in /resume.");
    return 0;
  }
  if (!options.remove) return 0;
  if (!options.yes) {
    const confirm =
      deps.confirm ?? ((question: string) => terminalPrompts(term)?.confirm(question) ?? false);
    const question = joined(plan);
    if (!confirm(`${question.charAt(0).toUpperCase()}${question.slice(1)}?`)) {
      out.line(
        "info",
        `Nothing moved. Use ${deps.command} sessions --finished --remove --yes to confirm without a terminal.`,
      );
      return 0;
    }
  }
  // The person may resume a conversation, or a record may change, while the question is open:
  // what moves is read again now, and each conversation is judged again as it moves.
  const now = read();
  if (now.error !== null) {
    out.line("fail", now.error);
    return 1;
  }
  try {
    const result = await sweepCrewConversations(paths, process.env, deps.now);
    let failed = false;
    for (const one of left.conversations) {
      const moved = result.outcomes.find(
        (two) => two.record.id === one.record.id && two.record.repo === one.record.repo,
      );
      if (moved === undefined) {
        out.line("info", `Kept ${one.record.name}: its conversation is no longer one to move.`);
        continue;
      }
      const outcome = moved.outcome;
      if (outcome.kind === "archived") {
        out.line(
          "removed",
          `Moved the conversation of ${one.record.name} (${counted(outcome.files, "file", "files")}) into ${tildify(outcome.dir, home)}.`,
        );
        for (const why of outcome.stayed ?? [])
          out.line("info", `Kept another conversation of ${one.record.name}: ${why}.`);
      } else if (outcome.kind === "kept")
        out.line("info", `Kept ${one.record.name}: ${outcome.why}.`);
      else if (outcome.kind === "failed") {
        failed = true;
        out.line("fail", `Could not move the conversation of ${one.record.name}: ${outcome.why}`, {
          fix: `Clear what the line says, then run ${deps.command} sessions --finished --remove again; what moved stays in the archive.`,
        });
      }
    }
    for (const folder of left.emptyFolders)
      if (now.emptyFolders.includes(folder) && !existsSync(folder))
        out.line("removed", `Removed the empty folder ${tildify(folder, home)}.`);
    for (const one of result.deleted)
      out.line("removed", `Deleted the archived conversation of ${one.name}.`);
    return failed ? 1 : 0;
  } catch (error) {
    out.line(
      "fail",
      `Could not run the conversation timeline: ${error instanceof Error ? error.message : String(error)}`,
      { fix: `Run ${deps.command} sessions --finished --remove again in a moment.` },
    );
    return 1;
  }
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
    // The person may resume a session or give it a crew role while the question is open.
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
  if (options.finished) return runFinishedSessions(paths, options, deps, resolve(cwd));
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
      const link = `warp://tab_config/${tabConfigName(repoKey(mainCheckout), session)}`;
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
  // A window that did not open is this command's failure, so a script around it can tell
  // that a session did not come back.
  return failed ? 1 : 0;
}
