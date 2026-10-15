/**
 * `anymodel usage`: which models answered the subagents, read from Claude Code's own
 * transcripts. Read only; it prints counts and model names, never a word of a message.
 *
 * Claude Code 2.1.300 writes each subagent of a session to
 * `<config>/projects/<project folder>/<session id>/subagents/agent-<id>.jsonl`, beside an
 * `agent-<id>.meta.json` that names how it was launched (`model`: `opus`, `sonnet`, `haiku`,
 * or none, which means it took the session's model). In the `.jsonl`, each line of
 * `type: "assistant"` is one content block of a reply: `message.id` names the reply,
 * `message.model` the model that wrote it (a cheap backend's own name when a slot answered,
 * `glm-5.3-flash` say), `timestamp` when, `cwd` the folder. (docs/claude-code-contract.md)
 *
 * Per session: the subagents launched in the window, how they were launched, the replies
 * by model, and the share of replies on an Opus model.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { type CliPaths, tildify } from "./paths";

export interface UsageOptions {
  /** Only sessions whose folder, or its last part, or the project folder's name, is this. */
  project: null | string;
  /** Milliseconds since the epoch: nothing older counts. */
  sinceMs: number;
}

/** One session's subagents. */
export interface SessionUsage {
  cwd: null | string;
  /** How each subagent was launched: `opus`, `sonnet`, `haiku`, or `inherited`. */
  launched: Record<string, number>;
  /** The project folder's name under `projects/`. */
  project: string;
  /** Replies by the model that wrote them. */
  replies: Record<string, number>;
  session: string;
  subagents: number;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function directories(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    // Not there, or not readable: nothing to count.
    return [];
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // A file being written, or not JSON: skipped.
    return null;
  }
}

/** One subagent's replies in the window, by model, and the first `cwd` it names. */
function readSubagent(
  path: string,
  sinceMs: number,
): { cwd: null | string; replies: Map<string, string> } {
  const replies = new Map<string, string>();
  let cwd: null | string = null;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { cwd, replies };
  }
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      // The last line may still be half written.
      continue;
    }
    if (!isJsonObject(entry)) continue;
    if (cwd === null && typeof entry.cwd === "string") cwd = entry.cwd;
    if (entry.type !== "assistant" || !isJsonObject(entry.message)) continue;
    const time = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
    if (!(time >= sinceMs)) continue;
    const model = typeof entry.message.model === "string" ? entry.message.model : "(unknown)";
    const id =
      typeof entry.message.id === "string"
        ? entry.message.id
        : typeof entry.uuid === "string"
          ? entry.uuid
          : `${replies.size}`;
    replies.set(id, model);
  }
  return { cwd, replies };
}

function matches(project: null | string, folder: string, cwd: null | string): boolean {
  if (project === null) return true;
  if (folder === project) return true;
  if (cwd === null) return false;
  return cwd === resolve(project) || basename(cwd) === project;
}

/** Every session with a subagent active in the window, read from `projectsDir`. */
export function collectUsage(projectsDir: string, options: UsageOptions): SessionUsage[] {
  const out: SessionUsage[] = [];
  for (const project of directories(projectsDir)) {
    for (const session of directories(join(projectsDir, project))) {
      const folder = join(projectsDir, project, session, "subagents");
      if (!existsSync(folder)) continue;
      const usage: SessionUsage = {
        cwd: null,
        launched: {},
        project,
        replies: {},
        session,
        subagents: 0,
      };
      let names: string[];
      try {
        names = readdirSync(folder)
          .filter((name) => name.endsWith(".meta.json"))
          .sort();
      } catch {
        continue;
      }
      for (const name of names) {
        const meta = readJson(join(folder, name));
        const transcript = join(folder, name.replace(/\.meta\.json$/, ".jsonl"));
        const { cwd, replies } = readSubagent(transcript, options.sinceMs);
        let started = Number.NEGATIVE_INFINITY;
        try {
          started = statSync(join(folder, name)).mtimeMs;
        } catch {
          // Gone since the listing.
        }
        if (replies.size === 0 && started < options.sinceMs) continue;
        usage.cwd ??= cwd;
        usage.subagents += 1;
        const launched =
          isJsonObject(meta) && typeof meta.model === "string" ? meta.model : "inherited";
        usage.launched[launched] = (usage.launched[launched] ?? 0) + 1;
        for (const model of replies.values()) {
          usage.replies[model] = (usage.replies[model] ?? 0) + 1;
        }
      }
      if (usage.subagents > 0 && matches(options.project, project, usage.cwd)) out.push(usage);
    }
  }
  return out;
}

const isOpus = (model: string) => /opus/i.test(model);

function counts(record: Record<string, number>): string {
  return Object.entries(record)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .map(([name, count]) => `${name} ${count}`)
    .join(", ");
}

function share(record: Record<string, number>): { opus: number; total: number } {
  let opus = 0;
  let total = 0;
  for (const [model, count] of Object.entries(record)) {
    total += count;
    if (isOpus(model)) opus += count;
  }
  return { opus, total };
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "-" : `${Math.round((part / whole) * 100)}%`;
}

/** The report's lines. */
export function formatUsage(
  sessions: SessionUsage[],
  hours: number,
  projectsDir: string,
  home: string,
): string {
  const lines = [
    `Subagents in the last ${hours} h, from ${tildify(projectsDir, home)} (read only; no message text)`,
  ];
  if (sessions.length === 0) {
    lines.push("", "No subagent ran in that time.");
    return lines.join("\n");
  }
  const all: Record<string, number> = {};
  let subagents = 0;
  for (const session of sessions) {
    lines.push(
      "",
      `${session.cwd === null ? session.project : tildify(session.cwd, home)}  session ${session.session.slice(0, 8)}`,
    );
    lines.push(`  ${session.subagents} subagents, launched as: ${counts(session.launched)}`);
    lines.push(`  replies by model: ${counts(session.replies) || "none in the window"}`);
    const { opus, total } = share(session.replies);
    lines.push(`  on Opus: ${opus} of ${total} replies (${percent(opus, total)})`);
    subagents += session.subagents;
    for (const [model, count] of Object.entries(session.replies)) {
      all[model] = (all[model] ?? 0) + count;
    }
  }
  const { opus, total } = share(all);
  lines.push(
    "",
    `Total: ${subagents} subagents in ${sessions.length} session${sessions.length === 1 ? "" : "s"}; on Opus: ${opus} of ${total} replies (${percent(opus, total)})`,
  );
  return lines.join("\n");
}

/** Parses `usage`'s options; an error in words on a wrong one. */
export function usageOptions(
  args: string[],
): { error: string } | { hours: number; project: null | string } {
  let hours = 6;
  let project: null | string = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--hours" && value !== undefined) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0)
        return { error: `--hours wants a number above 0, not "${value}"` };
      hours = parsed;
      index += 1;
    } else if (arg === "--project" && value !== undefined) {
      project = value;
      index += 1;
    } else {
      return { error: `Unknown option: ${arg ?? ""}` };
    }
  }
  return { hours, project };
}

/** Runs `anymodel usage`. */
export function runUsage(paths: CliPaths, args: string[], nowMs: number): number {
  const options = usageOptions(args);
  if ("error" in options) {
    console.error(
      `${options.error}\n\nUsage: anymodel usage [--hours <n>] [--project <folder or name>]`,
    );
    return 2;
  }
  const projectsDir = join(paths.claudeConfigDir, "projects");
  const sessions = collectUsage(projectsDir, {
    project: options.project,
    sinceMs: nowMs - options.hours * 3_600_000,
  });
  console.log(formatUsage(sessions, options.hours, projectsDir, paths.home));
  return 0;
}
