/**
 * Real paths for the guards that tell which checkout a path is in: a link on the way to a
 * path must not hide it. The one home of the memoized form (`main-folder-guard.ts` and
 * `git-guard.ts` both read it); the plain form is `realPath` in `git.ts`.
 */
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** `realPath`, remembering each path it answered: a long line names the same folders again and again. */
export type RealPath = (path: string) => string;

/**
 * A `RealPath` with its own memory. A path that is not there (yet), or too long, is answered
 * as the real path of its folder plus its own name, so a caller that needs the path to exist
 * checks that itself.
 */
export function memoizedRealPath(): RealPath {
  const known = new Map<string, string>();
  const real: RealPath = (path) => {
    const hit = known.get(path);
    if (hit !== undefined) return hit;
    let answer: string;
    try {
      answer = realpathSync(path);
    } catch {
      // Not there yet (or too long): the real path of its folder, and its own name.
      const parent = dirname(path);
      answer = parent === path ? path : join(real(parent), basename(path));
    }
    known.set(path, answer);
    return answer;
  };
  return real;
}
