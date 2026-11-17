/**
 * Where a `cd` goes: the one home of following a line's working folder. The git guard and the
 * main-folder guard read each command of a line in the folder the commands before it left.
 */
import { isAbsolute, resolve } from "node:path";

/**
 * The folder a command runs in: a path, or null when a `cd` went somewhere a guard cannot
 * follow.
 */
export type Folder = string | null;

/**
 * Where a `cd` / `Set-Location` / `pushd` goes, from `folder`: null when it cannot be worked
 * out (`cd -`, `cd`, `cd ~/x`, `cd $DIR`, `popd`).
 */
export function movedTo(program: string, folder: Folder, args: string[]): Folder {
  if (program === "popd") return null;
  // `-Path x` / `-LiteralPath x` (PowerShell), `/d x` (cmd), `-P x` (bash): the first word that is no option.
  const target = args.find((arg) => !arg.startsWith("-") && arg.toLowerCase() !== "/d");
  if (target === undefined || /^[~%]|[$`]/.test(target)) return null;
  // Git Bash on Windows writes `D:\x` as `/d/x`.
  const path =
    process.platform === "win32" ? target.replace(/^\/([A-Za-z])(?=\/|$)/, "$1:") : target;
  if (isAbsolute(path)) return resolve(path);
  return folder === null ? null : resolve(folder, path);
}
