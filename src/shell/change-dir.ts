/**
 * Where a `cd` goes: the one home of following a line's working folder. The git guard, the
 * main-folder guard and the session-escape guard read each command of a line in the folder the
 * commands before it left, and name paths as the platform reads them.
 */
import { posix, win32 } from "node:path";
import { CHANGE_DIR, type Dialect } from "./command";

/**
 * The folder a command runs in: a path, or null when a `cd` went somewhere a guard cannot
 * follow.
 */
export type Folder = string | null;

/** The programs that change the folder the next commands of the line run in. */
export const CHANGES_FOLDER: ReadonlySet<string> = new Set([...CHANGE_DIR, "push-location"]);

/** `node:path`'s Windows or POSIX rules, for the platform whose paths the line names. */
export function pathRules(platform: NodeJS.Platform): typeof posix {
  return platform === "win32" ? win32 : posix;
}

/**
 * A path a Bash line names, as the platform reads it. Claude Code's Bash tool is Git Bash on
 * Windows, where MSYS2 maps the drive `C:` to `/c`: a line that writes `/c/Users/…` writes
 * `C:/Users/…`. Read as it is, `/c/…` would look like a folder named `c` on whatever drive
 * the line runs on, and a write into the kit's own files would go unseen. PowerShell runs
 * natively, so its `/c/…` is no drive and is left alone.
 */
export function shellTargetPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
  dialect: Dialect = "bash",
): string {
  if (platform !== "win32" || dialect !== "bash") return path;
  const drive = /^\/+([A-Za-z])\//.exec(path);
  return drive === null ? path : `${drive[1]?.toUpperCase()}:/${path.slice(drive[0].length)}`;
}

/** What a caller knows that changes how a `cd` reads. */
export interface MovedOptions {
  /**
   * The home folder: with it, `~` and `~/x` are read, and a `cd` with no folder goes there.
   * Without it, `~` is a word the shell fills in, and a `cd` with no folder is unknown.
   */
  home?: string;
  /** The platform whose paths the line names. Default: this one. */
  platform?: NodeJS.Platform;
  dialect?: Dialect;
}

/** The words of a path that are not a path yet: a variable, a command, a glob, `%VAR%`. */
export const COMPUTED_PATH = /[$`*?[\]]|%\w+%/;

/**
 * Where a `cd` / `Set-Location` / `pushd` goes, from `folder`: null when it cannot be worked
 * out (`cd -`, `cd ~/x` with no home known, `cd $DIR`, `popd`). A command that names no folder
 * and is no `cd` (`Set-Location` alone) stays where it is, when the home is known.
 */
export function movedTo(
  program: string,
  folder: Folder,
  args: readonly string[],
  options: MovedOptions = {},
): Folder {
  const { dialect = "bash", home, platform = process.platform } = options;
  if (program === "popd") return null;
  // `-Path x` / `-LiteralPath x` (PowerShell), `/d x` (cmd), `-P x` (bash): the first word that is no option.
  const target = args.find((arg) => !arg.startsWith("-") && arg.toLowerCase() !== "/d");
  if (target === undefined) return home === undefined ? null : program === "cd" ? home : folder;
  const named =
    home !== undefined && /^~(?=$|[\\/])/.test(target) ? home + target.slice(1) : target;
  if (/^[~%]/.test(named) || COMPUTED_PATH.test(named)) return null;
  const path = shellTargetPath(named, platform, dialect);
  const rules = pathRules(platform);
  if (rules.isAbsolute(path)) return rules.resolve(path);
  return folder === null ? null : rules.resolve(folder, path);
}

/**
 * Follows `cd` through a line's steps: `folderOf(step)` is where the step runs. A `cd` inside
 * `( … )` or a substitution ends at its `)`, so the commands after it run where they did before.
 */
export class FolderTracker {
  private folder: Folder;
  /** The folder at each level of `( … )` the line is inside, outermost first. */
  private readonly outer: Folder[] = [];

  constructor(start: Folder) {
    this.folder = start;
  }

  /** The folder a step at `depth` (`ShellStep.subshellDepth`) runs in. */
  enter(depth: number): Folder {
    while (this.outer.length < depth) this.outer.push(this.folder);
    while (this.outer.length > depth) this.folder = this.outer.pop() ?? this.folder;
    return this.folder;
  }

  /** The step just run was a `cd`: the folder the rest of its level runs in. */
  moveTo(folder: Folder): void {
    this.folder = folder;
  }
}
