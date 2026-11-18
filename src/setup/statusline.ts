/**
 * Claude Code's status line setting, as setup writes it. Its own module, so the readers that only
 * compare it (the workflow's resolution, which every hook bundle loads) do not import all of
 * `setup` and what setup prints with (`src/cli/ui/`).
 */
import { join } from "node:path";
import type { CliPaths } from "../cli/paths";
import { shellWord } from "../shell/quote";
import { LAUNCHER_NAME } from "./launcher";
import type { KeyPath } from "./managed-json";

/** Claude Code's status line setting, an owned key when setup sets it. */
export const STATUSLINE_KEY: KeyPath = ["statusLine"];

/** The status line setting: the launcher, so it follows plugin updates. */
export function statuslineSetting(paths: CliPaths): Record<string, string> {
  return { command: `${shellWord(join(paths.binDir, LAUNCHER_NAME))} statusline`, type: "command" };
}
