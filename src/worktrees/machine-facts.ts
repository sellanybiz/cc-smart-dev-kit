/**
 * The facts about the machine that `worktrees --clean` judges: which Docker containers use a
 * worktree's files, and which programs run from inside it.
 *
 * WHY A PROCESS MATTERS
 *   Removing a worktree a program is using loses that program's files under it — a dev server
 *   started there, an editor, a background command — and on Windows the removal stops half
 *   way and leaves a folder nobody tracks (measured in the project this was ported from,
 *   2026-10-05: a git hook was running `lefthook.exe` from inside the worktree being removed).
 *   So the command asks, and keeps the worktree while something uses it.
 *
 *   Two probes, because they see different things:
 *   - the COMMAND LINES of the running processes (`ps -ww -o pid=,ppid=,args=` on macOS and
 *     Linux, `Get-CimInstance Win32_Process` on Windows): a program STARTED FROM a file inside
 *     the worktree names that file;
 *   - the WORKING FOLDER of each process (Linux only, `/proc/<pid>/cwd`): a dev server started
 *     with `cd <worktree> && …` names the worktree nowhere in its command line.
 *
 *   The tools this scan runs itself are left out (`git`, `docker`, `ps`, `powershell`): they
 *   are short-lived children of this command, and a `git status` in a worktree would
 *   otherwise keep it forever.
 *
 *   So is the command that is ASKING — `cc-smart-dev-kit worktrees --remove <path>` names the
 *   path in its own command line, and the shell that ran it, and the session above that, name
 *   it in theirs. None of them works in the worktree; they only asked about it. That is why
 *   each program's parent pid is read too: `programsInside` walks the chain up from this
 *   process, and leaves it out of the COMMAND-LINE match alone. A working folder still counts
 *   for every one of them (Linux), so the session or the shell that really sits in the
 *   worktree keeps it.
 *
 * Windows has no `ps` and no `/proc`: there the command lines alone are read, as the project
 * this came from did — and a folder a program still uses cannot be renamed there anyway, so
 * the move that starts a removal fails and nothing is touched.
 */
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { platform } from "node:os";
import { IGNORE_CASE, isInside, realPath } from "../hooks/git";

/** How long one docker command may take. Docker Desktop that is still starting can hang. */
const DOCKER_TIMEOUT_MS = 5000;

/** How long listing the running programs may take. */
const PROGRAMS_TIMEOUT_MS = 15_000;

/** A program running on this machine, and how it is known: its command line, or its folder. */
export interface RunningProgram {
  /** The file it was started from, when the command line says (null: only its folder is known). */
  path: null | string;
  pid: number;
  /**
   * The process that started it, when the listing says; absent when unknown. `programsInside`
   * walks it up from this process, to tell the command that ASKED about a worktree — one whose
   * own command line names it — from a program that uses it.
   */
  parentPid?: number;
  /**
   * When it was started (epoch ms), when known: where a program's environment cannot be read,
   * the removal of a finished crew session tells a program it left behind (started while the
   * session lived) from one started since (`stopLeftoverProcesses`, D62). The listing does not
   * carry it; `startTimes` reads it for the few programs a removal is about to stop, and a test
   * gives it. Absent when unknown.
   */
  startedAt?: number;
  /** The folder it works in, when that could be read (Linux only); absent when unknown. */
  cwd?: string;
}

/**
 * What `docker inspect --format` is asked for: each container's name and mounts, one JSON
 * object a line. Only these two — a container's full record also carries its environment,
 * which holds keys.
 */
export const CONTAINER_FORMAT = '{"name":{{json .Name}},"mounts":{{json .Mounts}}}';

/** A Docker container, running or stopped, and the sources of its bind mounts. */
export interface ContainerMounts {
  /** Without the `/` Docker puts in front. */
  name: string;
  /** Each bind mount's source, in the form Docker reports it. */
  sources: string[];
}

/**
 * Reads the answer to `docker inspect --format CONTAINER_FORMAT`. Only bind mounts count: a
 * named volume lives in Docker's own storage, never in a worktree. Null when a line does not
 * read — then nobody can say which files the containers use.
 */
export function parseContainerMounts(output: string): ContainerMounts[] | null {
  const containers: ContainerMounts[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return null;
    }
    if (typeof value !== "object" || value === null) return null;
    const { mounts, name } = value as Record<string, unknown>;
    if (typeof name !== "string") return null;
    if (mounts !== null && !Array.isArray(mounts)) return null;
    const listed: unknown[] = mounts ?? [];
    const sources: string[] = [];
    for (const mount of listed) {
      if (typeof mount !== "object" || mount === null) return null;
      const { Source, Type } = mount as Record<string, unknown>;
      if (Type === "bind" && typeof Source === "string") sources.push(Source);
    }
    containers.push({ name: name.replace(/^\//, ""), sources });
  }
  return containers;
}

/**
 * A bind mount's source as a path on this machine. Docker keeps the form it was given
 * (docker/for-win#13432). On Windows that is mostly `D:\a\b`, but a drive can also come as
 * `/d/a/b` (Git Bash), `/mnt/d/a/b` (WSL), or `/run/desktop/mnt/host/d/a/b` and
 * `/host_mnt/d/a/b` (Docker Desktop's own view of the drive). Elsewhere the source is the path.
 */
export function hostPath(source: string, windows: boolean): string {
  if (!windows) return source;
  const drive = /^\/(?:run\/desktop\/mnt\/host\/|host_mnt\/|mnt\/)?([a-zA-Z])(\/.*)?$/.exec(source);
  if (drive?.[1] === undefined) return source;
  return `${drive[1].toUpperCase()}:${drive[2] ?? "/"}`;
}

/**
 * The containers that mount the worktree or something inside it, by name. Removing the folder
 * takes their files away, and Docker cannot start them again. A container that mounts a
 * folder ABOVE the worktree does not count: its mount survives, and counting it would keep
 * every worktree under that folder for good.
 *
 * Both sides are compared as REAL paths: a worktree may be reached through a symlink — `git
 * worktree list` prints the path it was made with — while Docker reports the physical one,
 * and the comparison must see them as one place.
 */
export function containersUsing(
  worktree: string,
  containers: ContainerMounts[],
  ignoreCase = IGNORE_CASE,
): string[] {
  const real = realPath(worktree);
  return containers
    .filter((container) =>
      container.sources.some((source) =>
        isInside(realPath(hostPath(source, ignoreCase)), real, ignoreCase),
      ),
    )
    .map((container) => container.name);
}

/**
 * `<pid><tab><parent pid><tab><file>` lines, the shape PowerShell is asked for. A line that
 * does not hold all three is skipped: it names no file, and there is no folder here to fall
 * back on.
 */
export function parsePrograms(lines: string): RunningProgram[] {
  const programs: RunningProgram[] = [];
  for (const line of lines.split(/\r?\n/)) {
    const fields = line.split("\t");
    const pid = Number(fields[0]?.trim() ?? "");
    const parentPid = Number(fields[1]?.trim() ?? "");
    const path = fields.slice(2).join("\t").trim();
    if (!Number.isInteger(pid) || pid <= 0) continue;
    // pid 1's parent is 0; a process whose parent is unknown is not printed this way.
    if (!Number.isInteger(parentPid) || parentPid < 0) continue;
    if (path === "") continue;
    programs.push({ parentPid, path, pid });
  }
  return programs;
}

/**
 * `<pid><spaces><parent pid><spaces><the whole command line>` lines, the shape
 * `ps -ww -o pid=,ppid=,args=` prints. A process with no arguments left prints its pid and its
 * parent alone, and the parent pid is no file: such a line is skipped, and on Linux its working
 * folder (`/proc/<pid>/cwd`) still says whether it uses a worktree.
 */
export function parseCommandLines(lines: string): RunningProgram[] {
  const programs: RunningProgram[] = [];
  for (const line of lines.split(/\r?\n/)) {
    const text = line.trim();
    if (text === "") continue;
    const afterPid = text.indexOf(" ");
    if (afterPid === -1) continue;
    const pid = Number(text.slice(0, afterPid));
    const rest = text.slice(afterPid + 1).trimStart();
    const afterParent = rest.indexOf(" ");
    if (afterParent === -1) continue;
    const parentPid = Number(rest.slice(0, afterParent));
    const path = rest.slice(afterParent + 1).trim();
    // `ps` prints our own `ps` too; it names no worktree folder, so it falls out anyway.
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (!Number.isInteger(parentPid) || parentPid < 0) continue;
    if (path === "") continue;
    programs.push({ parentPid, path, pid });
  }
  return programs;
}

/**
 * Does a command line name `folder` — the folder itself, or a path inside it? A command line
 * is not a path, so the folder has to appear with a boundary after it: `/work/app-wt-x` in
 * `/work/app-wt-x/server.ts` counts, and the same text in `/work/app-wt-xyz` does not.
 */
export function mentions(line: string, folder: string): boolean {
  const form = (text: string) => text.replace(/\\/g, "/");
  const inFolder = form(line);
  const at = form(folder).replace(/\/+$/, "").toLowerCase();
  const lower = inFolder.toLowerCase();
  for (let index = lower.indexOf(at); index !== -1; index = lower.indexOf(at, index + 1)) {
    const after = inFolder[index + at.length];
    if (after === undefined || after === "/" || after === " " || after === "'" || after === '"') {
      return true;
    }
  }
  return false;
}

/**
 * The pids of `pid` and of every process that started it, up to pid 1, as far as the listing
 * says — the chain one command runs in. A pid that appears twice ends the walk (a reused pid
 * is no descent), and a process the listing does not hold contributes nothing.
 */
function lineage(programs: RunningProgram[], pid: number): Set<number> {
  const parents = new Map<number, number>();
  for (const program of programs) {
    if (program.parentPid !== undefined) parents.set(program.pid, program.parentPid);
  }
  const chain = new Set<number>([pid]);
  let at = pid;
  for (;;) {
    // pid 1's parent is 0: the chain ends there.
    const parent = parents.get(at);
    if (parent === undefined || parent <= 0 || chain.has(parent)) break;
    chain.add(parent);
    at = parent;
  }
  return chain;
}

/**
 * True when `pid` is `ancestor` or was started by it, as far as the listing says: the chain a
 * session's shell and the program it ran form. A dead session's orphans are reparented, so a
 * listing read after the end often cannot prove this — the crew id in a program's environment is
 * the other witness (`stopLeftoverProcesses`, `src/crew/end.ts`, D62).
 */
export function descendsFrom(programs: RunningProgram[], pid: number, ancestor: number): boolean {
  return lineage(programs, pid).has(ancestor);
}

/**
 * The seconds a process has been running, from `ps`: `etimes` prints whole seconds, and the
 * older macOS `etime` prints `[[dd-]hh:]mm:ss`. Null when neither reads.
 */
export function parseElapsedSeconds(text: string): null | number {
  const value = text.trim();
  if (/^\d+$/.test(value)) return Number(value);
  const parts = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(value);
  if (parts === null) return null;
  const days = Number(parts[1] ?? 0);
  const hours = Number(parts[2] ?? 0);
  const minutes = Number(parts[3] ?? 0);
  const seconds = Number(parts[4] ?? 0);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/**
 * When the processes `pids` started (epoch ms), by pid, from `ps -o pid=,etimes= -p <pids>`.
 * macOS has no `etimes`; there `etime` gives the elapsed time in a form `parseElapsedSeconds`
 * reads. Asked only for the few programs a removal is about to stop, never for the whole
 * machine. A pid `ps` does not know, and a `ps` that cannot answer, leave that start unknown —
 * and an unknown start never proves a program belongs to a finished session (`crew rm` keeps the
 * worktree then). `ps -p` exits 1 when one pid is gone and still prints the others, so its
 * output counts whatever the exit code says. Windows has no such `ps`: nothing is known there.
 */
export function startTimes(pids: readonly number[], now: number): Map<number, number> {
  const starts = new Map<number, number>();
  if (pids.length === 0) return starts;
  const read = (format: string): void => {
    let output: string;
    try {
      const run = Bun.spawnSync(["ps", "-o", `pid=,${format}=`, "-p", pids.join(",")], {
        stderr: "pipe",
        stdout: "pipe",
        timeout: PROGRAMS_TIMEOUT_MS,
      });
      output = run.stdout.toString();
    } catch {
      // No `ps` here (Windows): the starts stay unknown.
      return;
    }
    for (const line of output.split(/\r?\n/)) {
      const fields = line.trim().split(/\s+/);
      const pid = Number(fields[0]);
      const seconds = parseElapsedSeconds(fields[1] ?? "");
      if (!Number.isInteger(pid) || pid <= 0 || seconds === null) continue;
      starts.set(pid, now - seconds * 1000);
    }
  };
  read("etimes");
  if (starts.size === 0) read("etime");
  return starts;
}

/** The tools this scan runs itself: short-lived children that would otherwise keep a worktree. */
const OUR_TOOLS = new Set(["git", "docker", "ps", "powershell", "pgrep"]);

/**
 * The name a line prints for a program: the file it was started from, without its folder, or
 * its pid when only its working folder is known.
 */
export function programName(program: RunningProgram): string {
  const file = (program.path ?? "").split(/[\s"'`]/)[0] ?? "";
  const base = file.replace(/^.*[\\/]/, "");
  return base === "" ? `pid ${String(program.pid)}` : base;
}

/**
 * The programs of the listing that use `worktree`: one started from a file inside it (its
 * command line names it), or one whose working folder is inside it (Linux). The tools this scan
 * runs itself are left out.
 *
 * So is `ownPid` — the process asking, this one by default — and every process that started
 * it: the command line of `cc-smart-dev-kit worktrees --remove <path>` names the worktree, and
 * so does the shell that ran it, and the session above that. They only asked about it, so
 * they never count. They still count when their WORKING FOLDER is inside the worktree: the
 * session or the shell that really sits there is what keeps it.
 *
 * A worktree can be reached through a symlink: `git worktree list` prints the path it was made
 * with, while `/proc/<pid>/cwd` — and a command line written from it — holds the physical one.
 * So the working folder is compared as a real path on both sides, and a command line is
 * matched against BOTH forms of the worktree.
 *
 * One home for the matching rule: `programsInside` names them, and a crew session's removal
 * asks which pids they are (`stopLeftoverProcesses`, `src/crew/end.ts`).
 */
export function programsUsing(
  programs: RunningProgram[],
  worktree: string,
  ignoreCase = IGNORE_CASE,
  ownPid = process.pid,
): RunningProgram[] {
  const asking = lineage(programs, ownPid);
  const real = realPath(worktree);
  const forms = real === worktree ? [worktree] : [worktree, real];
  const found: RunningProgram[] = [];
  for (const program of programs) {
    const named = program.path !== null && forms.some((form) => mentions(program.path ?? "", form));
    const working = program.cwd !== undefined && isInside(realPath(program.cwd), real, ignoreCase);
    if (!named && !working) continue;
    // The chain that asked names the worktree only in its command line — unless one of them
    // works in it, and then `working` says so and it counts.
    if (!working && asking.has(program.pid)) continue;
    if (OUR_TOOLS.has(programName(program))) continue;
    found.push(program);
  }
  return found;
}

/** The programs that use `worktree`, each once, sorted by name (`programsUsing`). */
export function programsInside(
  programs: RunningProgram[],
  worktree: string,
  ignoreCase = IGNORE_CASE,
  ownPid = process.pid,
): string[] {
  const names = new Set<string>();
  for (const program of programsUsing(programs, worktree, ignoreCase, ownPid)) {
    names.add(programName(program));
  }
  return [...names].sort();
}

/** Runs docker. Null when Docker is not installed; not ok when it fails or takes too long. */
function docker(args: string[]): null | { err: string; ok: boolean; out: string } {
  try {
    const run = Bun.spawnSync(["docker", ...args], {
      stderr: "pipe",
      stdout: "pipe",
      timeout: DOCKER_TIMEOUT_MS,
      // The clean may run detached from a hook, with no console of its own on Windows.
      windowsHide: true,
    });
    return {
      err: run.stderr.toString().trim(),
      ok: run.exitCode === 0,
      out: run.stdout.toString().trim(),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return { err: String(error), ok: false, out: "" };
  }
}

/**
 * Every Docker container, running or stopped, with the sources of its bind mounts. A stopped
 * one counts: Docker starts it again by itself, and a source that is gone by then breaks it
 * (a local database stack once lost the files it mounts that way, after the worktree it had
 * been started from was removed).
 *
 * None when Docker is not installed. "unknown" when it is installed but does not answer in
 * time — Docker Desktop not started yet — and then nothing may be removed.
 */
export function dockerMounts(): "unknown" | ContainerMounts[] {
  const listed = docker(["ps", "--all", "--quiet", "--no-trunc"]);
  if (listed === null) return [];
  if (!listed.ok) return "unknown";
  const ids = listed.out.split(/\s+/).filter((id) => id !== "");
  if (ids.length === 0) return [];
  // A container removed between the two calls fails this one: the next run asks again.
  const inspected = docker(["inspect", "--format", CONTAINER_FORMAT, ...ids]);
  if (inspected === null || !inspected.ok) return "unknown";
  return parseContainerMounts(inspected.out) ?? "unknown";
}

/**
 * Prints `<pid><tab><parent pid><tab><file>` for every running program started from a file, in
 * UTF-8. The parent pid comes along so that the command line of the program asking, and of the
 * chain that started it, can be told from one that uses the worktree (`programsInside`).
 */
const LIST_PROGRAMS =
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " +
  "Get-CimInstance Win32_Process | Where-Object ExecutablePath | " +
  'ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.ExecutablePath)" }';

/** Every running process's working folder, from `/proc` (Linux), by pid. */
function cwdOf(pid: number): string | undefined {
  try {
    return readlinkSync(`/proc/${String(pid)}/cwd`);
  } catch {
    // Another user's process, or one that ended: nothing to see.
    return undefined;
  }
}

/** The pids under `/proc`, as numbers. */
function procPids(): number[] {
  try {
    return readdirSync("/proc")
      .filter((name) => /^\d+$/.test(name))
      .map(Number);
  } catch {
    return [];
  }
}

/**
 * Every running program that could use a worktree, with what is known about each. "unknown"
 * when they cannot be listed: then nothing may be removed.
 *
 * Linux reads both the command lines and each process's working folder; macOS reads the
 * command lines (no `/proc`); Windows reads the executable paths through PowerShell, since a
 * folder a program's file is in cannot be renamed there. When a process started is asked
 * separately, for the few programs a removal is about to stop (`startTimes`).
 */
export function runningPrograms(on: NodeJS.Platform = platform()): "unknown" | RunningProgram[] {
  if (on === "win32") {
    try {
      const run = Bun.spawnSync(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", LIST_PROGRAMS],
        {
          stderr: "pipe",
          stdout: "pipe",
          timeout: PROGRAMS_TIMEOUT_MS,
          // The clean may run detached from a hook, with no console of its own on Windows.
          windowsHide: true,
        },
      );
      return run.exitCode === 0 ? parsePrograms(run.stdout.toString()) : "unknown";
    } catch {
      // PowerShell missing or not starting: the safe answer keeps every worktree.
      return "unknown";
    }
  }
  let lines: string;
  try {
    const run = Bun.spawnSync(["ps", "-ww", "-o", "pid=,ppid=,args="], {
      stderr: "pipe",
      stdout: "pipe",
      timeout: PROGRAMS_TIMEOUT_MS,
    });
    if (run.exitCode !== 0) return "unknown";
    lines = run.stdout.toString();
  } catch {
    return "unknown";
  }
  const programs = parseCommandLines(lines);
  if (on !== "linux") return programs;
  for (const pid of procPids()) {
    const cwd = cwdOf(pid);
    if (cwd === undefined) continue;
    const known = programs.find((program) => program.pid === pid);
    if (known === undefined) programs.push({ cwd, path: null, pid });
    else known.cwd = cwd;
  }
  return programs;
}

/** Mount destinations from Linux mountinfo, including same-device bind mounts. */
export function parseMountPoints(text: string): string[] | null {
  const mounts: string[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const fields = line.split(" ");
    const separator = fields.indexOf("-");
    const destination = fields[4];
    if (
      separator < 6 ||
      fields.length < separator + 4 ||
      !/^\d+$/.test(fields[0] ?? "") ||
      !/^\d+$/.test(fields[1] ?? "") ||
      !/^\d+:\d+$/.test(fields[2] ?? "") ||
      destination === undefined ||
      !destination.startsWith("/") ||
      /\\(?!040|011|012|134)/.test(destination)
    )
      return null;
    mounts.push(
      destination.replace(/\\(040|011|012|134)/g, (_, octal: string) =>
        String.fromCharCode(Number.parseInt(octal, 8)),
      ),
    );
  }
  return mounts.includes("/") ? mounts : null;
}

/** Unknown on unsupported systems or an unreadable listing: never assume no mounts. */
export function mountPoints(on: NodeJS.Platform = platform()): "unknown" | string[] {
  if (on !== "linux") return "unknown";
  try {
    return parseMountPoints(readFileSync("/proc/self/mountinfo", "utf8")) ?? "unknown";
  } catch {
    return "unknown";
  }
}
