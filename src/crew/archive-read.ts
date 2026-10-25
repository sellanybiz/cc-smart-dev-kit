/**
 * Claude Code's saved transcripts as a reader sees them: the projects folder, and the kit's
 * crew archive beside it (`archive.ts`), as one tree.
 *
 * Claude Code writes a session to `<config>/projects/<project folder>/<session id>.jsonl`, and
 * each subagent of it to `<project folder>/<session id>/subagents/agent-<id>.jsonl` (with an
 * `agent-<id>.meta.json` beside it). A removed crew session's files move into
 * `<stateDir>/crew-archive/<repo key>/<crew id>/projects/`, in the same layout, each file gzipped
 * on its own (`.gz` added) and keeping its last-write time. So a reader that walks this tree counts
 * a removed crew session's replies as it did before the move (`usage.ts`, `flow.ts`).
 *
 * **One copy of each file.** A file still in the projects folder wins over its archived copy: a
 * move that stopped halfway leaves the same file in both places for a moment, and it is counted
 * once.
 *
 * Read only, and nothing here throws: a folder that is not there or cannot be read holds nothing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

/** The kit's archive of removed crew sessions' conversations: `<stateDir>/crew-archive`. */
export function crewArchiveRoot(stateDir: string): string {
  return join(stateDir, "crew-archive");
}

/** The folder of one archive that holds Claude Code's own layout. */
export const ARCHIVE_PROJECTS = "projects";

/** The suffix an archived file carries. */
const GZ = ".gz";

/** One transcript file: where it is, and whether it is gzipped (an archived copy). */
export interface TranscriptRef {
  path: string;
  gz: boolean;
}

/** One session's files, by their names in Claude Code's own layout. */
export interface SessionFiles {
  /** `<session id>.jsonl`; null when only its folder is there. */
  main: null | TranscriptRef;
  /** The files of `<session id>/subagents/`: `agent-<id>.jsonl`, `agent-<id>.meta.json`. */
  subagents: Map<string, TranscriptRef>;
}

/** Every session by project folder, then by session id. */
export type TranscriptTree = Map<string, Map<string, SessionFiles>>;

/** The entries of a folder, by kind, sorted; empty when it is not there or cannot be read. */
function listed(path: string): { dirs: string[]; files: string[] } {
  try {
    const all = readdirSync(path, { withFileTypes: true });
    const names = (keep: (entry: (typeof all)[number]) => boolean) =>
      all
        .filter(keep)
        .map((entry) => entry.name)
        .sort();
    return { dirs: names((entry) => entry.isDirectory()), files: names((entry) => entry.isFile()) };
  } catch {
    // Not there, or not readable: nothing to read.
    return { dirs: [], files: [] };
  }
}

/** Adds one projects-like folder to `tree`; a file already there stays. */
function addRoot(tree: TranscriptTree, root: string, gz: boolean): void {
  const suffix = gz ? GZ : "";
  const plain = (name: string) => (gz ? name.slice(0, -GZ.length) : name);
  for (const project of listed(root).dirs) {
    const folder = join(root, project);
    const here = listed(folder);
    const ids = new Set([
      ...here.files
        .filter((name) => name.endsWith(`.jsonl${suffix}`))
        .map((name) => plain(name).slice(0, -".jsonl".length)),
      ...here.dirs,
    ]);
    if (ids.size === 0) continue;
    const sessions = tree.get(project) ?? new Map<string, SessionFiles>();
    tree.set(project, sessions);
    for (const id of [...ids].sort()) {
      const session = sessions.get(id) ?? { main: null, subagents: new Map() };
      sessions.set(id, session);
      const main = `${id}.jsonl${suffix}`;
      if (session.main === null && here.files.includes(main)) {
        session.main = { gz, path: join(folder, main) };
      }
      const subagents = join(folder, id, "subagents");
      for (const name of listed(subagents).files) {
        if (gz && !name.endsWith(GZ)) continue;
        const key = plain(name);
        if (!session.subagents.has(key)) {
          session.subagents.set(key, { gz, path: join(subagents, name) });
        }
      }
    }
  }
}

/**
 * Every saved session: those of `projectsDir`, then the archived ones of `stateDir`'s crew
 * archive (none when `stateDir` is null). A file the projects folder still holds is read from
 * there.
 */
export function transcriptTree(projectsDir: string, stateDir: null | string): TranscriptTree {
  const tree: TranscriptTree = new Map();
  addRoot(tree, projectsDir, false);
  if (stateDir === null) return tree;
  const root = crewArchiveRoot(stateDir);
  for (const key of listed(root).dirs) {
    for (const crew of listed(join(root, key)).dirs) {
      addRoot(tree, join(root, key, crew, ARCHIVE_PROJECTS), true);
    }
  }
  return tree;
}

/** A transcript's bytes, unzipped when it is an archived copy; null when it cannot be read. */
export function transcriptBytes(ref: TranscriptRef): Buffer | null {
  try {
    const bytes = readFileSync(ref.path);
    return ref.gz ? gunzipSync(bytes) : bytes;
  } catch {
    // Gone since the listing, not readable, or not a whole gzip file.
    return null;
  }
}

/** A transcript's text; null when it cannot be read. */
export function transcriptText(ref: TranscriptRef): null | string {
  return transcriptBytes(ref)?.toString("utf8") ?? null;
}

/** When a transcript was last written, in ms (an archived copy keeps its file's time); -Infinity when it is gone. */
export function transcriptChangedAt(ref: TranscriptRef): number {
  try {
    return statSync(ref.path).mtimeMs;
  } catch {
    // Gone since the listing.
    return Number.NEGATIVE_INFINITY;
  }
}
