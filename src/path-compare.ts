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
import { resolve } from "node:path";

/** Folders compare without case on Windows only. */
export const IGNORE_CASE = process.platform === "win32";

/**
 * Is `path` the folder itself, or inside it? `..` and `.` are resolved first, so
 * `app/../app-wt-x` is not "inside app". `\` and `/` are the same separator.
 */
export function isInside(path: string, folder: string, ignoreCase = IGNORE_CASE): boolean {
  const form = (p: string) => {
    // `\` becomes `/` before the resolve too, so a Windows path's `..` is resolved on any host
    // (a test of a Windows path runs on Linux as well).
    const forward = resolve(p.replace(/\\/g, "/")).replace(/\\/g, "/").replace(/\/+$/, "");
    return ignoreCase ? forward.toLowerCase() : forward;
  };
  const child = form(path);
  const parent = form(folder);
  return child === parent || child.startsWith(`${parent}/`);
}

/** Are `a` and `b` the same place (as `isInside` reads them)? */
export function samePath(a: string, b: string, ignoreCase = IGNORE_CASE): boolean {
  return isInside(a, b, ignoreCase) && isInside(b, a, ignoreCase);
}

/** Is `path` inside `folder`, and not the folder itself? */
export function isStrictlyInside(path: string, folder: string, ignoreCase = IGNORE_CASE): boolean {
  return isInside(path, folder, ignoreCase) && !isInside(folder, path, ignoreCase);
}
