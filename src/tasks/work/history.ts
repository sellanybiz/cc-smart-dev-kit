/**
 * A work task's history as text (D75): one line per change, oldest first, with when, what and
 * who. `task_get` and `task show` print it from here, so the server and the command never word
 * one change two ways. The entries themselves are written by `store.ts`, in the change's own
 * transaction.
 */
import type { WorkEvent } from "./types";

/** The order fields are named in, and the words a person reads for each. */
const FIELDS: readonly [key: string, label: string][] = [
  ["kind", "kind"],
  ["plan", "plan"],
  ["phase", "phase"],
  ["subject", "subject"],
  ["status", "status"],
  ["parent", "parent"],
  ["crew", "crew"],
  ["claim", "claimed by"],
  ["waitsFor", "waits for"],
  ["description", "description"],
  ["note", "note"],
];

/** Who made the change: the session (name and id), its crew and process, or the kit's reason. */
function actor(event: WorkEvent): string {
  const parts: string[] = [];
  if (event.sessionId !== null) {
    const name = event.sessionName ? `"${event.sessionName}" ` : "";
    parts.push(`session ${name}${event.sessionId}`);
  }
  if (event.crewId !== null) parts.push(`crew ${event.crewId}`);
  if (event.pid !== null) parts.push(`process ${event.pid}`);
  if (event.reason !== null) parts.push(`the kit (${event.reason})`);
  return parts.length > 0 ? parts.join(", ") : "a caller outside any Claude session";
}

function shown(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "none";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "none";
  if (key === "subject" || key === "note") return JSON.stringify(value);
  return String(value);
}

/** A description is long: its line gives its length, and `full` prints the text itself. */
function descriptionText(event: WorkEvent, before: unknown, after: unknown): string {
  const length = (value: unknown) => (typeof value === "string" ? value.length : 0);
  if (event.action === "created") return `description ${length(after)} characters`;
  if (event.action === "deleted") return `description ${length(before)} characters`;
  return `description changed, ${length(before)} → ${length(after)} characters`;
}

function fieldText(event: WorkEvent, key: string, label: string): string | null {
  const change = event.changes[key];
  if (change === undefined) return null;
  const [before, after] = change;
  if (key === "description") return descriptionText(event, before, after);
  if (event.action === "created" || event.action === "noted")
    return `${label} ${shown(key, after)}`;
  if (event.action === "deleted") return `${label} ${shown(key, before)}`;
  return `${label} ${shown(key, before)} → ${shown(key, after)}`;
}

/** One line for one entry. */
export function historyLine(event: WorkEvent): string {
  const fields = FIELDS.map(([key, label]) => fieldText(event, key, label)).filter(
    (text): text is string => text !== null,
  );
  const what = event.action === "deleted" ? "deleted; its last version:" : `${event.action}:`;
  return `${new Date(event.at).toISOString()} by ${actor(event)} · ${what} ${fields.join("; ")}`;
}

/**
 * The whole history. With `full`, each description an entry replaced or set is printed in full
 * under its line, so every earlier version can be read back.
 */
export function historyText(events: readonly WorkEvent[], options: { full: boolean }): string {
  if (events.length === 0) return "History: none recorded.";
  const lines = ["History (oldest first):"];
  for (const event of events) {
    lines.push(historyLine(event));
    const description = event.changes.description;
    if (!options.full || description === undefined) continue;
    const [before, after] = description;
    if (event.action !== "created" && typeof before === "string")
      lines.push("  description before:", indent(before));
    if (event.action !== "deleted" && typeof after === "string")
      lines.push("  description after:", indent(after));
  }
  return lines.join("\n");
}

function indent(text: string): string {
  return text === ""
    ? "    (empty)"
    : text
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");
}
