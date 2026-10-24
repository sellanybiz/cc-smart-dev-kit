import type { ClaudeMemCurrent } from "@/api/types";
import { targetBackend, targetModel } from "@/lib/format";

/**
 * The claude-mem card's words for a value, apart from the card so they are tested (MS2, D63).
 * Each names only a model the machine gave: never a guessed default.
 */

type Fallback = ClaudeMemCurrent["fallback"];

/** The value the Claude route and the Claude fallback send: the provider's own name. */
export const CLAUDE = "claude";
export const OFF = "off";

/** claude-mem's own Claude model, as the fallback list offers it. */
export function ownClaudeModelWords(fallback: Fallback): string {
  // `claudeModel` is claude-mem's own model only while no fallback model is picked.
  const own = fallback.provider === CLAUDE && fallback.model === null ? fallback.claudeModel : null;
  return `claude-mem's own Claude model${own === null ? "" : ` (${own})`}`;
}

/** The fallback now: an empty one is Claude (claude-mem's default), with the model it runs on. */
export function fallbackWords(fallback: Fallback): string {
  if (fallback.provider === OFF) return "Off: claude-mem waits for its route's provider";
  if (fallback.provider === CLAUDE) {
    if (fallback.model !== null) return `Claude, on your own login: ${fallback.model}`;
    return `Claude, on your own login: claude-mem's own ${
      fallback.claudeModel === null ? "built-in model" : `model, ${fallback.claudeModel}`
    }`;
  }
  if (fallback.target !== null) {
    return `${targetModel(fallback.target)} on ${targetBackend(fallback.target)}`;
  }
  return fallback.provider;
}

/** The take-over's lead line: how many values the kit leaves alone because they are the person's. */
export function takenOverWords(count: number): string {
  return count === 1
    ? "One value in claude-mem's file was set by hand"
    : `${count} values in claude-mem's file were set by hand`;
}
