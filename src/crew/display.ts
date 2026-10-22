/**
 * How a crew session's own facts are shown: the model and what answers it, how long ago a change
 * happened, the memory its session holds, and the last line of a program's output.
 *
 * One home, so the board, the status and any later view say the same thing about the same
 * crew session (`dynamic.md` § One source per value).
 */

/** The model as it was named, and `named → resolved` when another model answers it. */
export function modelText(named: string, resolved: string): string {
  return resolved === named ? named : `${named} → ${resolved}`;
}

/**
 * How long ago a moment was, in words a person reads: "just now", "7 min ago", "2 h ago",
 * "3 d ago". `iso` is a time as the store writes it (ISO 8601). A moment in the future (a clock
 * that moved) reads as "just now"; a text that is no time is shown as it is written.
 */
export function agoText(iso: string, nowMs: number): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const minutes = Math.floor((nowMs - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** The memory a crew session's Claude session holds, or a dash while the watch has not read it. */
export function memoryText(memoryMb: number | null): string {
  return memoryMb === null ? "-" : `${memoryMb} MB`;
}

/** The last line of a program's output that says something, trimmed; empty for none. */
export function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
}
