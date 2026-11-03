/**
 * The worktrees answer, read off the server's event loop.
 *
 * The scan (`worktreesAnswerOf`, `src/worktrees/command.ts`) runs git and the machine's own
 * readers synchronously — every worktree's status, the running sessions, the programs and the
 * Docker containers — which is hundreds of milliseconds on a warm machine and more on a big
 * repository with a cold cache. Run in the server, it froze every page, every action and the
 * live stream for that long. So the portal never calls it: it runs the CLI's own
 * `worktrees --json` in a child (`runCliChildText`, the portal's one spawn in `cli-child.ts`,
 * never `spawnSync`) and reads its answer — the same builder the command prints, so the page
 * and the command can never disagree.
 *
 * Requests that ask the same folder at once share one child, and an answer stays good for
 * `WORKTREES_FRESH_MS` from its arrival (`shortCache`, `cli-child.ts`, the one home for the
 * rule): the sidebar and the Work page both ask within a moment of each other. A failure is
 * not kept, so the next request tries again.
 */

import type { WorktreeItem, WorktreesAnswer } from "../worktrees/command";
import { runCliChildText, shortCache } from "./cli-child";
import type { PortalContext } from "./context";

/** How long the child may take: the scan fetches nothing, but a cold cache on a big repo is slow. */
export const WORKTREES_CHILD_TIMEOUT_MS = 120_000;

/** How long one answer is reused for the same folder. */
export const WORKTREES_FRESH_MS = 5_000;

/** The answer, or why it could not be read, in words a page can show. */
export type WorktreesRead = { answer: WorktreesAnswer } | { error: string };

/** One answer per folder, kept for `WORKTREES_FRESH_MS` (`shortCache`'s rules). */
const scans = shortCache<string, WorktreesRead>(WORKTREES_FRESH_MS);

export function forgetWorktrees(ctx: PortalContext): void {
  scans.forget(ctx);
}

/** The worktrees of the folder `cwd`, from the CLI's own `worktrees --json` in a child. */
export function readWorktreesOffLoop(ctx: PortalContext, cwd: string): Promise<WorktreesRead> {
  return scans.read(ctx, cwd, () => runWorktrees(ctx, cwd));
}

async function runWorktrees(ctx: PortalContext, cwd: string): Promise<WorktreesRead> {
  // The folder the page asks about is the child's own: the repository the answer is about.
  const run = await runCliChildText(ctx, ["worktrees", "--json"], {
    cwd,
    subject: "the worktrees scan",
    timeoutMs: WORKTREES_CHILD_TIMEOUT_MS,
  });
  if ("error" in run) return run;
  const answer = worktreesOf(run.output);
  return answer === null
    ? { error: "the worktrees scan's answer was not one this portal reads" }
    : { answer };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const KINDS: ReadonlySet<unknown> = new Set(["finished", "gone", "kept", "main"]);
const FROM: ReadonlySet<unknown> = new Set(["config", "default", "origin"]);

/** One worktree of the answer, when it holds the fields the page draws; null otherwise. */
function worktreeOf(value: unknown): null | WorktreeItem {
  if (!isObject(value)) return null;
  const { branch, head, idleMinutes, kind, path, why } = value;
  if (typeof head !== "string" || typeof path !== "string" || !KINDS.has(kind)) return null;
  if (branch !== null && typeof branch !== "string") return null;
  if (why !== null && typeof why !== "string") return null;
  if (idleMinutes !== null && typeof idleMinutes !== "number") return null;
  return { branch, head, idleMinutes, kind, path, why } as WorktreeItem;
}

/**
 * The answer in the child's output: its shape and the fields the pages read checked, or null.
 * A newer CLI that renamed one is refused, never drawn as blanks.
 */
function worktreesOf(output: string): null | WorktreesAnswer {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    return null;
  }
  if (!isObject(value)) return null;
  const { autoClean, base, from, note, worktrees } = value;
  if (typeof base !== "string" || !FROM.has(from)) return null;
  if (note !== null && typeof note !== "string") return null;
  if (!Array.isArray(worktrees)) return null;
  const items = worktrees.map(worktreeOf);
  if (items.some((one) => one === null)) return null;
  // The last clean's record: the page only reads it as written, or shows nothing.
  if (autoClean !== null) {
    if (!isObject(autoClean)) return null;
    if (
      typeof autoClean.base !== "string" ||
      typeof autoClean.lastRunAt !== "string" ||
      !Array.isArray(autoClean.removed)
    ) {
      return null;
    }
  }
  return { autoClean, base, from, note, worktrees: items } as WorktreesAnswer;
}
