/**
 * A folder only its owner can read: `mkdir` 0700, and an existing folder that others can read or
 * write is tightened, with one line saying so.
 *
 * The browser's output folder is why this exists: it holds screenshots and downloaded pages of a
 * signed-in session. It is NOT in `src/setup/file-mode.ts` on purpose — that module is imported by
 * the router bundle, and a new helper there would change `plugin/dist/router.js` and make every
 * machine restart its router (`.claude/rules/bundles-and-releases.md`).
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { setFileMode } from "../setup/file-mode";
import { hostPlatform } from "./host";

export function ensurePrivateDir(
  dir: string,
  say: (line: string) => void,
  platform: NodeJS.Platform = hostPlatform(),
): void {
  if (existsSync(dir)) {
    const mode = statSync(dir).mode & 0o777;
    if ((mode & 0o077) === 0) return;
    setFileMode(dir, 0o700, platform);
    say(`${dir} was readable by other users (mode ${mode.toString(8)}): made it yours only (700)`);
    return;
  }
  mkdirSync(dir, { mode: 0o700, recursive: true });
  setFileMode(dir, 0o700, platform);
}
