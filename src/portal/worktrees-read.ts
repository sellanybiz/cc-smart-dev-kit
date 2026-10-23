/**
 * The worktrees answer, read off the server's event loop.
 *
 * The scan (`worktreesAnswerOf`, `src/worktrees/command.ts`) runs git and the machine's own
 * readers synchronously — every worktree's status, the running sessions, the programs and the
 * Docker containers — which is hundreds of milliseconds on a warm machine and more on a big
 * repository with a cold cache. Run in the server, it froze every page, every action and the
 * live stream for that long. So the portal never calls it: it runs the CLI's own
 * `worktrees --json` in a child (`Bun.spawn`, never `spawnSync`) and reads its answer — the
 * same builder the command prints, so the page and the command can never disagree.
 *
 * Requests that ask the same folder at once share one child, and an answer stays good for
 * `WORKTREES_FRESH_MS`: the sidebar and the Work page both ask within a moment of each other.
 * A failure is not kept, so the next request tries again.
 */

import { join } from "node:path";
import { bunConfigArg } from "../setup/bun-config";
import { commandContext } from "../update/apply";
import type { WorktreeItem, WorktreesAnswer } from "../worktrees/command";
import type { PortalContext } from "./context";

/** How long the child may take: the scan fetches nothing, but a cold cache on a big repo is slow. */
export const WORKTREES_CHILD_TIMEOUT_MS = 120_000;

/** How long one answer is reused for the same folder. */
export const WORKTREES_FRESH_MS = 5_000;

/** The answer, or why it could not be read, in words a page can show. */
export type WorktreesRead = { answer: WorktreesAnswer } | { error: string };

/**
 * Drops this portal's kept answers: an action that adds or removes a worktree (`crew rm`,
 * `worktrees.clean`) makes them stale, and the page's next read must scan again instead of
 * showing the list from before the action for up to `WORKTREES_FRESH_MS`.
 */
export function forgetWorktrees(ctx: PortalContext): void {
  kept.delete(ctx);
}

interface Kept {
  at: number;
  read: Promise<WorktreesRead>;
}

/** One entry per portal context and folder: what is running, or what answered last. */
const kept = new WeakMap<PortalContext, Map<string, Kept>>();

/** The worktrees of the folder `cwd`, from the CLI's own `worktrees --json` in a child. */
export function readWorktreesOffLoop(ctx: PortalContext, cwd: string): Promise<WorktreesRead> {
  let byFolder = kept.get(ctx);
  if (byFolder === undefined) {
    byFolder = new Map();
    kept.set(ctx, byFolder);
  }
  const now = ctx.now();
  const last = byFolder.get(cwd);
  if (last !== undefined && now - last.at < WORKTREES_FRESH_MS) return last.read;
  const read = runWorktrees(ctx, cwd);
  const entry: Kept = { at: now, read };
  byFolder.set(cwd, entry);
  // A failure is not kept: the next request tries again.
  void read.then((answer) => {
    if ("error" in answer && byFolder.get(cwd) === entry) byFolder.delete(cwd);
  });
  return read;
}

async function runWorktrees(ctx: PortalContext, cwd: string): Promise<WorktreesRead> {
  const folder = ctx.pluginFolder();
  if ("error" in folder) return { error: folder.error };
  const context = commandContext(ctx.env, ctx.paths.home);
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        bunConfigArg(folder.folder),
        join(folder.folder, "dist", "cli.js"),
        "worktrees",
        "--json",
      ],
      {
        // The folder the page asks about: the repository the answer is about.
        cwd,
        // The portal's own paths, whatever its environment says: the child reads the same
        // folders the server does.
        env: { ...context.env, CLAUDE_CONFIG_DIR: ctx.paths.claudeConfigDir, HOME: ctx.paths.home },
        stderr: "pipe",
        stdin: "ignore",
        stdout: "pipe",
        timeout: WORKTREES_CHILD_TIMEOUT_MS,
        windowsHide: true,
      },
    );
    const [output, errors, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) {
      const why = errors.trim().split("\n").at(-1)?.trim() ?? "";
      return {
        error: `the worktrees scan did not run (exit ${exitCode})${why === "" ? "" : `: ${why}`}`,
      };
    }
    const answer = worktreesOf(output);
    return answer === null
      ? { error: "the worktrees scan's answer was not one this portal reads" }
      : { answer };
  } catch (error) {
    return {
      error: `the worktrees scan did not run: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
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
