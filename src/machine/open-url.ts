/**
 * Opening a URL in the person's own desktop — a browser page such as the portal.
 *
 * One home for the three ways this works, so desktop callers cannot drift apart:
 *
 * - **Windows:** `cmd.exe /c start "" <url>`. There is no `xdg-open` there, and `start` is
 *   cmd's own builtin. The empty `""` is the window title `start` takes first: without it a
 *   quoted URL would be read as the title. `cmd.exe` is named in full, because a bare `cmd`
 *   is not a file name on Windows (it needs the `.exe`).
 * - **macOS:** `open <url>`.
 * - **Linux:** `xdg-open <url>`, then `gio open <url>` as the fallback.
 *
 * The caller picks the first candidate the machine actually has (`which`), and a candidate
 * that fails to start is not fatal: the link has usually been printed already, so the person
 * can open it by hand (`src/entries/portal.ts`).
 */

/** One way to open the URL: the program first, then its arguments (a program is always there). */
export type OpenArgv = [string, ...string[]];

/** A non-empty list of ways to open the URL, in the order to try them. */
export type OpenCandidates = [OpenArgv, ...OpenArgv[]];

/** Every way to open `url` on this platform, best first. */
export function openUrlCandidates(on: NodeJS.Platform, url: string): OpenCandidates {
  if (on === "win32") return [["cmd.exe", "/c", "start", "", url]];
  if (on === "darwin") return [["open", url]];
  return [
    ["xdg-open", url],
    ["gio", "open", url],
  ];
}

export interface OpenUrlDeps {
  /** The full path of a program on PATH, or null. */
  which: (name: string) => null | string;
  /** Starts the program, without waiting for it and without failing the caller. */
  spawn: (argv: string[]) => void;
}

/**
 * Opens `url` with the first candidate this machine has. Silent about everything: it never
 * waits, never throws, and never fails the command that asked (the portal prints its link
 * first, and a person can open that by hand).
 */
export function openUrlOnDesktop(
  on: NodeJS.Platform,
  url: string,
  deps: OpenUrlDeps,
): string | null {
  for (const argv of openUrlCandidates(on, url)) {
    const program = argv[0];
    if (deps.which(program) === null) continue;
    try {
      deps.spawn(argv);
      return program;
    } catch {
      // The next candidate may work; the caller has the URL printed either way.
    }
  }
  return null;
}
