/**
 * One live `herdr wait` per lead. A wait covers every child of its lead (`kit.lead`), so a second
 * one for the same lead only repeats the first and wakes the lead twice. The lock is the kit's
 * own (`withLock`): its holder is judged by its process, so a wait that died leaves nothing behind
 * that blocks the next one. The holder also writes `waiter.json` beside the lock, so the second
 * wait can say who runs.
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { LockBusyError, withLock } from "../setup/lock";
import { writePrivate } from "./brief";

const DETAILS_FILE = "waiter.json";

/** What a running wait tells the next one. */
export interface WaiterDetails {
  pid: number;
  /** When the wait began, in milliseconds. */
  startedAt: number;
  mode: "any" | "all";
  timeoutMs: number;
}

/** The folder of one lead's wait lock. The lead's id has a `/`: it is encoded, never a path. */
export function waiterFolder(stateDir: string, leadId: string): string {
  return join(stateDir, "herdr", "waiters", encodeURIComponent(leadId));
}

function readDetails(folder: string): WaiterDetails | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(folder, DETAILS_FILE), "utf8"));
  } catch {
    // No file, or not JSON: the holder has not written it yet, or a holder of an older kit.
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { pid, startedAt, mode, timeoutMs } = parsed as Record<string, unknown>;
  if (
    typeof pid !== "number" ||
    typeof startedAt !== "number" ||
    (mode !== "any" && mode !== "all") ||
    typeof timeoutMs !== "number"
  )
    return null;
  return { pid, startedAt, mode, timeoutMs };
}

/** What `onlyWaiter` found: it ran `fn`, or another wait of the lead holds the lock. */
export type OnlyWaiter<T> = { ran: true; value: T } | { ran: false; running: WaiterDetails | null };

/**
 * Runs `fn` as the lead's one wait. When another live wait holds the lock it does not run `fn`
 * and says who holds it (`running`, null when that wait has not written its details yet).
 */
export async function onlyWaiter<T>(
  stateDir: string,
  leadId: string,
  details: Omit<WaiterDetails, "pid" | "startedAt">,
  fn: () => Promise<T>,
): Promise<OnlyWaiter<T>> {
  const folder = waiterFolder(stateDir, leadId);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  try {
    const value = await withLock(
      folder,
      async () => {
        const file = join(folder, DETAILS_FILE);
        await writePrivate(
          file,
          `${JSON.stringify({ ...details, pid: process.pid, startedAt: Date.now() })}\n`,
        );
        try {
          return await fn();
        } finally {
          rmSync(file, { force: true });
        }
      },
      { waitMs: 0 },
    );
    return { ran: true, value };
  } catch (error) {
    if (error instanceof LockBusyError) return { ran: false, running: readDetails(folder) };
    throw error;
  }
}
