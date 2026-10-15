/**
 * `anymodel usage`: which models answered this machine's Claude Code sessions, main
 * sessions and subagents apart, read from Claude Code's own transcripts. Read only; it
 * prints counts and model names, never a word of a message.
 *
 * Claude Code 2.1.300 writes a session's own conversation to
 * `<config>/projects/<project folder>/<session id>.jsonl`, and each subagent of it to
 * `<config>/projects/<project folder>/<session id>/subagents/agent-<id>.jsonl`, beside an
 * `agent-<id>.meta.json` that names how it was launched (`model`: `opus`, `sonnet`, `haiku`,
 * or none, which means it took the session's model). In a `.jsonl`, each line of
 * `type: "assistant"` is one content block of a reply: `message.id` names the reply,
 * `message.model` the model that wrote it (a cheap backend's own name when a slot answered,
 * `glm-5.3-flash` say), `timestamp` when, `cwd` the folder. (docs/claude-code-contract.md)
 *
 * What it counts, in the window: per session, the main session's replies by model; the
 * subagents launched, how, their replies by model, and the share of those on an Opus model.
 * A file last changed before the window holds nothing in it, and is not read.
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

/** One session: its own replies and its subagents'. */
export interface SessionUsage {
  cwd: null | string;
  /** How each subagent was launched: `opus`, `sonnet`, `haiku`, or `inherited`. */
  launched: Record<string, number>;
  /** The main session's own replies, by the model that wrote them. */
  main: Record<string, number>;
  /** The project folder's name under `projects/`. */
  project: string;
  /** The subagents' replies, by the model that wrote them. */
  replies: Record<string, number>;
  session: string;
  subagents: number;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The entries of a folder, by kind; empty when it is not there or not readable. */
function entries(path: string): { dirs: string[]; files: string[] } {
  try {
    const all = readdirSync(path, { withFileTypes: true });
    return {
      dirs: all
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
      files: all
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort(),
    };
  } catch {
    // Not there, or not readable: nothing to count.
    return { dirs: [], files: [] };
  }
}

/** A file's last change, in ms; -Infinity when it is gone. */
function changedAt(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    // Gone since the listing.
    return Number.NEGATIVE_INFINITY;
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

/**
 * One transcript's replies in the window, by model, and the first `cwd` it names. Skipped
 * unread (no replies) when the file last changed before the window. `sidechains`: false
 * for a main session, whose file may hold a subagent's lines in older Claude Code versions.
 */
function readTranscript(
  path: string,
  sinceMs: number,
  sidechains: boolean,
): { cwd: null | string; replies: Map<string, string> } {
  const replies = new Map<string, string>();
  let cwd: null | string = null;
  if (changedAt(path) < sinceMs) return { cwd, replies };
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
    if (!sidechains && entry.isSidechain === true) continue;
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

function count(into: Record<string, number>, replies: Map<string, string>): void {
  for (const model of replies.values()) into[model] = (into[model] ?? 0) + 1;
}

/** Every session with a reply, or a subagent, in the window, read from `projectsDir`. */
export function collectUsage(projectsDir: string, options: UsageOptions): SessionUsage[] {
  const out: SessionUsage[] = [];
  for (const project of entries(projectsDir).dirs) {
    const folder = join(projectsDir, project);
    const listed = entries(folder);
    const sessions = new Set([
      ...listed.files.filter((name) => name.endsWith(".jsonl")).map((name) => name.slice(0, -6)),
      ...listed.dirs,
    ]);
    for (const session of [...sessions].sort()) {
      const usage: SessionUsage = {
        cwd: null,
        launched: {},
        main: {},
        project,
        replies: {},
        session,
        subagents: 0,
      };
      const own = readTranscript(join(folder, `${session}.jsonl`), options.sinceMs, false);
      usage.cwd = own.cwd;
      count(usage.main, own.replies);
      const subagents = join(folder, session, "subagents");
      const metas = existsSync(subagents)
        ? entries(subagents).files.filter((name) => name.endsWith(".meta.json"))
        : [];
      for (const name of metas) {
        const transcript = join(subagents, name.replace(/\.meta\.json$/, ".jsonl"));
        const started = changedAt(join(subagents, name));
        const { cwd, replies } = readTranscript(transcript, options.sinceMs, true);
        if (replies.size === 0 && started < options.sinceMs) continue;
        const meta = readJson(join(subagents, name));
        usage.cwd ??= cwd;
        usage.subagents += 1;
        const launched =
          isJsonObject(meta) && typeof meta.model === "string" ? meta.model : "inherited";
        usage.launched[launched] = (usage.launched[launched] ?? 0) + 1;
        count(usage.replies, replies);
      }
      const active = own.replies.size > 0 || usage.subagents > 0;
      if (active && matches(options.project, project, usage.cwd)) out.push(usage);
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

function add(into: Record<string, number>, from: Record<string, number>): void {
  for (const [model, count] of Object.entries(from)) into[model] = (into[model] ?? 0) + count;
}

/** The report's lines. */
export function formatUsage(
  sessions: SessionUsage[],
  hours: number,
  projectsDir: string,
  home: string,
): string {
  const lines = [
    `Claude Code replies in the last ${hours} h, main sessions and subagents apart, from ${tildify(projectsDir, home)} (read only; no message text)`,
  ];
  if (sessions.length === 0) {
    lines.push("", "No session answered in that time.");
    return lines.join("\n");
  }
  const main: Record<string, number> = {};
  const replies: Record<string, number> = {};
  let mainSessions = 0;
  let subagents = 0;
  let withSubagents = 0;
  for (const session of sessions) {
    lines.push(
      "",
      `${session.cwd === null ? session.project : tildify(session.cwd, home)}  session ${session.session.slice(0, 8)}`,
    );
    lines.push(`  main session, replies by model: ${counts(session.main) || "none in the window"}`);
    if (session.subagents === 0) {
      lines.push("  subagents: none in the window");
    } else {
      lines.push(`  ${session.subagents} subagents, launched as: ${counts(session.launched)}`);
      lines.push(`  subagent replies by model: ${counts(session.replies) || "none in the window"}`);
      const { opus, total } = share(session.replies);
      lines.push(`  subagents on Opus: ${opus} of ${total} replies (${percent(opus, total)})`);
      withSubagents += 1;
    }
    if (Object.keys(session.main).length > 0) mainSessions += 1;
    subagents += session.subagents;
    add(main, session.main);
    add(replies, session.replies);
  }
  const { opus, total } = share(replies);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  lines.push(
    "",
    `Main sessions: ${plural(mainSessions, "session")}; replies by model: ${counts(main) || "none"}`,
    `Subagents: ${subagents} in ${plural(withSubagents, "session")}; replies by model: ${counts(replies) || "none"}; on Opus: ${opus} of ${total} replies (${percent(opus, total)})`,
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
