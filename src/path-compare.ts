/**
 * Comparing two paths: is one the other, or inside it? The one home of that test, for every
 * part of the plugin — the hooks (worktrees, the main checkout), setup and restore (the
 * instructions' copy, the state folder), and `migrate` (a folder that moved).
 *
 * Why not `file.startsWith(`${folder}/`)`: on Windows a path is written with `\`, so that
 * test never matches there (the instructions' copy looked "not installed" on every Windows
 * machine), and Windows compares folder names without case. This test turns `\` into `/`
 * first, resolves `.` and `..`, and ignores case on Windows only.
 *
 * It lives at the top of `src/`, beside `ports.ts`, because no one folder owns it: the hooks
 * import from `src/setup/`, and `src/setup/` must not import from `src/hooks/`.
 */
import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Folders compare without case on Windows only. */
export const IGNORE_CASE = process.platform === "win32";

/**
 * Is `path` the folder itself, or inside it? `..` and `.` are resolved first, so
 * `app/../app-wt-x` is not "inside app". `\` and `/` are the same separator.
 */
export function isInside(path: string, folder: string, ignoreCase = IGNORE_CASE): boolean {
  const child = pathForm(path, ignoreCase);
  const parent = pathForm(folder, ignoreCase);
  return child === parent || child.startsWith(`${parent}/`);
}

/**
 * The one form of a path every test here compares: `.` and `..` resolved, `/` for every
 * separator, no trailing `/`, and lower case where folders compare without it. Two paths
 * `samePath` calls one place have the same form, so it also serves as a key for a file per
 * place (the background clean's record of a repo, `src/worktrees/auto-state.ts`).
 */
export function pathForm(path: string, ignoreCase = IGNORE_CASE): string {
  // `\` becomes `/` before the resolve too, so a Windows path's `..` is resolved on any host
  // (a test of a Windows path runs on Linux as well).
  const forward = resolve(path.replace(/\\/g, "/")).replace(/\\/g, "/").replace(/\/+$/, "");
  return ignoreCase ? forward.toLowerCase() : forward;
}

/** Are `a` and `b` the same place (as `isInside` reads them)? */
export function samePath(a: string, b: string, ignoreCase = IGNORE_CASE): boolean {
  return isInside(a, b, ignoreCase) && isInside(b, a, ignoreCase);
}

/**
 * A folder's identity on disk, its device and file id; null when it cannot be read, or when
 * the file system gives no id (a 0), so two folders never look the same by accident.
 */
function folderId(path: string): null | string {
  try {
    const stat = statSync(path, { bigint: true });
    return stat.ino === 0n ? null : `${stat.dev}:${stat.ino}`;
  } catch {
    return null;
  }
}

/**
 * `isInside`, also across two spellings of one folder. On Windows a folder may be named with
 * an 8.3 short name (`C:\Users\RUNNER~1\…`) while git and Claude Code report the long one, and
 * `realpathSync` keeps the spelling it was given, so the text alone says "not inside". When
 * the text says no, `folder` is compared on disk with `path` and each folder above it. A
 * folder that cannot be read compares by its text alone.
 */
export function isInsideOnDisk(path: string, folder: string, ignoreCase = IGNORE_CASE): boolean {
  if (isInside(path, folder, ignoreCase)) return true;
  const target = folderId(folder);
  if (target === null) return false;
  let at = resolve(path);
  for (;;) {
    if (folderId(at) === target) return true;
    const up = dirname(at);
    if (up === at) return false;
    at = up;
  }
}

/** Are `a` and `b` the same folder, by text or on disk (`isInsideOnDisk`)? */
export function sameFolderOnDisk(a: string, b: string, ignoreCase = IGNORE_CASE): boolean {
  if (samePath(a, b, ignoreCase)) return true;
  const id = folderId(a);
  return id !== null && id === folderId(b);
}

/** Is `path` inside `folder`, and not the folder itself? */
export function isStrictlyInside(path: string, folder: string, ignoreCase = IGNORE_CASE): boolean {
  return isInside(path, folder, ignoreCase) && !isInside(folder, path, ignoreCase);
}
