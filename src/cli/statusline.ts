/**
 * `anymodel statusline`: one line for Claude Code's status bar.
 *
 * Claude Code runs the status line command after each reply and passes a JSON object on
 * stdin (docs/claude-code-contract.md). The usage numbers come from there:
 * `rate_limits.five_hour` / `rate_limits.seven_day`, each with `used_percentage` (0 to 100)
 * and `resets_at` (Unix seconds). Claude Code fills them from the
 * `anthropic-ratelimit-unified-*` headers of Anthropic's answers, which the router passes
 * on unchanged; they are there only for a Claude subscription, after the first answer.
 *
 * What it shows, parts joined by ` · `:
 *   - the model's display name;
 *   - a model slot answering from its fallback (`⚠ claude-opus-5-5 at its limit → omniroute:…
 *     until 13:00`), and `judge: fallback active (…)` when the judge answers safety checks;
 *   - a plan limit the router saw, with no fallback (`⛔ claude-opus-5-5 at its plan limit
 *     until 13:00`): a refused request brings Claude Code no new numbers, so only the
 *     router's state file (`limit-state.ts`) knows it;
 *   - `5h 23% · 7d 41%`, and from 85 % a warning with the reset time.
 * It reads two small files and prints; no network.
 */

import { readFileSync } from "node:fs";
import {
  currentFallbacks,
  currentLimits,
  formatClock,
  type LimitState,
  parseLimitState,
} from "../gateway/limit-state";
import { JUDGE_SLOT } from "../gateway/targets";
import type { CliPaths } from "./paths";

/** From this share of a plan window, the status line warns. */
export const WARN_PERCENT = 85;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One window's numbers from the status line input; null when Claude Code gave none. */
function window(
  input: Record<string, unknown>,
  name: string,
): null | { percent: number; resetsAt: null | number } {
  const limits = input.rate_limits;
  if (!isJsonObject(limits)) return null;
  const entry = limits[name];
  if (!isJsonObject(entry) || typeof entry.used_percentage !== "number") return null;
  return {
    percent: entry.used_percentage,
    resetsAt: typeof entry.resets_at === "number" ? entry.resets_at : null,
  };
}

/** The status line for this input and state, at `nowMs`. */
export function statuslineText(
  input: unknown,
  state: LimitState | null,
  nowMs: number,
  timeZone?: string,
): string {
  const parts: string[] = [];
  const data = isJsonObject(input) ? input : {};
  const model = isJsonObject(data.model) ? data.model.display_name : undefined;
  if (typeof model === "string" && model !== "") parts.push(model);
  const until = (resetsAt: null | number) =>
    resetsAt === null ? "" : ` until ${formatClock(resetsAt, nowMs, timeZone)}`;

  const covered = new Set<string>();
  if (state !== null) {
    for (const [slot, record] of currentFallbacks(state, nowMs)) {
      if (slot === JUDGE_SLOT) {
        parts.push(`judge: fallback active (${record.target})`);
        continue;
      }
      covered.add(record.model);
      parts.push(`⚠ ${record.model} at its limit → ${record.target}${until(record.resetsAt)}`);
    }
    for (const [limited, record] of currentLimits(state, nowMs)) {
      if (!covered.has(limited))
        parts.push(`⛔ ${limited} at its plan limit${until(record.resetsAt)}`);
    }
  }

  for (const [name, label] of [
    ["five_hour", "5h"],
    ["seven_day", "7d"],
  ] as const) {
    const numbers = window(data, name);
    if (numbers === null) continue;
    const percent = Math.round(numbers.percent);
    parts.push(
      percent >= WARN_PERCENT
        ? `⚠ ${label} ${percent}%${numbers.resetsAt === null ? "" : ` (resets ${formatClock(numbers.resetsAt, nowMs, timeZone)})`}`
        : `${label} ${percent}%`,
    );
  }
  return parts.join(" · ");
}

/** Runs the command: stdin from Claude Code, the router's state file; prints one line. */
export async function runStatusline(
  paths: CliPaths,
  readStdin: () => Promise<string>,
  nowMs: number,
): Promise<number> {
  let input: unknown = null;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    // Run by hand, or a newer Claude Code: show what the state file knows.
    input = null;
  }
  let state: LimitState | null = null;
  try {
    state = parseLimitState(readFileSync(paths.gatewayStateFile, "utf8"));
  } catch {
    // No router state yet.
    state = null;
  }
  console.log(statuslineText(input, state, nowMs));
  return 0;
}
