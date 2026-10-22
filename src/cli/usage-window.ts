/**
 * Claude Code's 5-hour usage window: the one reader of `rate_limits.five_hour`, and the state
 * file the status line records it in (D54).
 *
 * The number exists in one place only: the JSON Claude Code passes to the status line command
 * on stdin, filled from Anthropic's `anthropic-ratelimit-unified-5h-*` headers
 * (`docs/claude-code-contract.md` § The status line). Nothing else on the machine is told it —
 * not the router's state file, not a transcript — so the status line writes it down when it
 * reads it, and the commands that need it read it back: `crew start`'s opus guard and
 * `crew list` (`src/crew/usage-guard.ts`).
 *
 * The file is `<stateDir>/usage-window.json`, mode 600, the kit's own state:
 * `{"fiveHour": {"percent": 87, "resetsAt": 1792600800}, "readAt": "2026-10-23T…"}`. It is
 * written only when the numbers change, so `readAt` is when they were last seen. A window whose
 * `resetsAt` has passed measured a window that is over: it reads as unknown — never as its old
 * number — and the guard does not hold on it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { atomicWrite } from "../setup/write";
import type { CliPaths } from "./paths";

/** The window Claude Code calls the plan's 5-hour window. */
export const FIVE_HOUR_WINDOW = "five_hour";

/** One window of the status line input: the share used, and when it resets (Unix seconds). */
export interface UsageWindow {
  percent: number;
  resetsAt: null | number;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One window's numbers from a status line input; null when the input gives none. */
export function windowOf(input: unknown, name: string): UsageWindow | null {
  if (!isJsonObject(input)) return null;
  const limits = input.rate_limits;
  if (!isJsonObject(limits)) return null;
  const entry = limits[name];
  if (!isJsonObject(entry) || typeof entry.used_percentage !== "number") return null;
  return {
    percent: entry.used_percentage,
    resetsAt: typeof entry.resets_at === "number" ? entry.resets_at : null,
  };
}

/** The 5-hour window of a status line input; null when it gives none. */
export function fiveHourWindow(input: unknown): UsageWindow | null {
  return windowOf(input, FIVE_HOUR_WINDOW);
}

/** The file the status line records the window in. */
export function usageWindowFile(paths: CliPaths): string {
  return join(paths.stateDir, "usage-window.json");
}

/** The record as written; loose, so a field a newer kit adds stays. */
const storedSchema = z.looseObject({
  fiveHour: z.object({ percent: z.number(), resetsAt: z.number().nullable() }),
  readAt: z.string(),
});

/** What the file holds, or null when there is none or it cannot be read. */
function readStored(file: string): null | { fiveHour: UsageWindow; readAt: string } {
  if (!existsSync(file)) return null;
  try {
    const parsed = storedSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    // A file that cannot be read is no reading: the guard does not hold on a guess.
    return null;
  }
}

/**
 * Records the 5-hour window a status line just read. Nothing when the input has none (an API
 * key, or a refused request: Claude Code sends no `rate_limits` then), and nothing when the
 * numbers are the ones already stored, so a busy machine writes once per change, not per reply.
 * A write that fails throws; the status line catches it and prints.
 */
export function recordUsageWindow(paths: CliPaths, input: unknown, nowMs: number): void {
  const fiveHour = fiveHourWindow(input);
  if (fiveHour === null) return;
  const file = usageWindowFile(paths);
  const stored = readStored(file);
  if (
    stored !== null &&
    stored.fiveHour.percent === fiveHour.percent &&
    stored.fiveHour.resetsAt === fiveHour.resetsAt
  ) {
    return;
  }
  atomicWrite(
    file,
    `${JSON.stringify({ fiveHour, readAt: new Date(nowMs).toISOString() }, null, 2)}\n`,
    0o600,
  );
}

/**
 * The last recorded 5-hour window, as of `nowMs`; null when there is none, it cannot be read,
 * or the window it measured has already reset (a number from a window that is over is no
 * number now).
 */
export function readUsageWindow(paths: CliPaths, nowMs: number): UsageWindow | null {
  const stored = readStored(usageWindowFile(paths));
  if (stored === null) return null;
  const { resetsAt } = stored.fiveHour;
  if (resetsAt !== null && resetsAt * 1000 <= nowMs) return null;
  return stored.fiveHour;
}
