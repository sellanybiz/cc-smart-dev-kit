/**
 * The session-start part that keeps the portal running (D10): the plugin's SessionStart hook
 * starts it like claude-mem's worker, in the background, and never waits for it.
 *
 * **The hook itself does no work here.** It resolves the portal bundle of the version Claude
 * Code records as installed — never its own version folder, which an update may have replaced
 * — and starts that bundle detached with `--ensure`, which does the probe, the copy, the
 * restart of an older version and the start (`src/portal/lifecycle.ts`). So a start stays
 * quick, no network happens in the hook, and two sessions that start together each start a
 * starter: one wins the port, and the other finds it answering.
 *
 * It never runs in `claude -p` (`CLAUDE_CODE_SESSION_ATTENDED=0`): a headless run must not
 * leave a page listening for it. It runs on `startup` and `resume`, not on a `clear` or a
 * `compact` of a session that is already going.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { isAttended } from "../hooks/attended";
import { sessionStarts } from "../update/background";
import { portalStarterArgv } from "./lifecycle";

/** Why the part did or did not start the portal; the hook itself says nothing about it. */
export type PortalStartReason = "no-bundle" | "not-a-start" | "started" | "unattended";

export interface PortalStartDeps {
  /** `process.execPath`: the bun the starter runs on. */
  bunPath: string;
  /**
   * The plugin Claude Code records as installed: the folder whose `dist/portal.js` is the
   * starter. Null when there is no record (`findUserInstall`).
   */
  installed: null | { folder: string };
  /** Why the hook runs (`startup`, `resume`, `clear`, `compact`, `fork`); null when unknown. */
  source: null | string;
  /** The hook's environment: whether a person is there (`CLAUDE_CODE_SESSION_ATTENDED`). */
  env: Record<string, string | undefined>;
  /** Where and with what the starter runs: the home folder, without git's repo variables. */
  runIn: { cwd: string; env: Record<string, string> };
  /** Starts it detached and returns at once; a test records the call instead. */
  spawn: (argv: string[], options: { cwd: string; env: Record<string, string> }) => void;
}

/** True when this session start starts the portal: a person's session, at its start or resume. */
export function portalStartsAtSessionStart(
  env: Record<string, string | undefined>,
  source: null | string,
): boolean {
  return isAttended(env) && sessionStarts(source);
}

/**
 * Starts the portal's starter when this session start should: one detached process, never
 * waited for, nothing on stdout. A broken install (no bundle) starts nothing; `doctor` says
 * what is missing.
 */
export function startPortalAtSessionStart(deps: PortalStartDeps): PortalStartReason {
  if (!isAttended(deps.env)) return "unattended";
  if (!sessionStarts(deps.source)) return "not-a-start";
  const installed = deps.installed;
  if (installed === null) return "no-bundle";
  const bundle = join(installed.folder, "dist", "portal.js");
  if (!existsSync(bundle)) return "no-bundle";
  deps.spawn(portalStarterArgv(deps.bunPath, bundle, installed.folder), deps.runIn);
  return "started";
}
