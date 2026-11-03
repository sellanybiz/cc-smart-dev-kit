/** The saved session and subagent transcript layout. Unreadable folders hold no files. */
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** One saved transcript file. */
export interface TranscriptRef {
  path: string;
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
function addRoot(tree: TranscriptTree, root: string): void {
  for (const project of listed(root).dirs) {
    const folder = join(root, project);
    const here = listed(folder);
    const ids = new Set([
      ...here.files
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => name.slice(0, -".jsonl".length)),
      ...here.dirs,
    ]);
    if (ids.size === 0) continue;
    const sessions = tree.get(project) ?? new Map<string, SessionFiles>();
    tree.set(project, sessions);
    for (const id of [...ids].sort()) {
      const session = sessions.get(id) ?? { main: null, subagents: new Map() };
      sessions.set(id, session);
      const main = `${id}.jsonl`;
      if (session.main === null && here.files.includes(main)) {
        session.main = { path: join(folder, main) };
      }
      const subagents = join(folder, id, "subagents");
      for (const name of listed(subagents).files) {
        const key = name;
        if (!session.subagents.has(key)) {
          session.subagents.set(key, { path: join(subagents, name) });
        }
      }
    }
  }
}

/** Every saved session in Claude Code's projects folder. */
export function transcriptTree(projectsDir: string): TranscriptTree {
  const tree: TranscriptTree = new Map();
  addRoot(tree, projectsDir);
  return tree;
}
