/**
 * A removed crew session's conversation leaves Claude Code's `/resume` list (AR1).
 *
 * `claude rm <short id>` deletes a background session's job and its worktree, never its
 * conversation: `<config>/projects/<project folder>/<session id>.jsonl` and the `<session id>/`
 * folder beside it (its subagents' transcripts, its tool results) stay, and `/resume` lists them
 * for ever. Claude Code's own `cleanupPeriodDays` cannot help: it deletes every conversation older
 * than its days, the person's own too.
 *
 * So when the kit removes a crew session — `crew rm`, and the watch's removal after a merge, which
 * runs the same steps (`runCrewRm`) — and only after `claude rm` succeeded, its conversation moves
 * into the kit's own state:
 *
 *   <stateDir>/crew-archive/<repo key>/<crew id>/archive.json  who it was, from where, and when
 *   <stateDir>/crew-archive/<repo key>/<crew id>/report.json   a copy of its hand-back report
 *   <stateDir>/crew-archive/<repo key>/<crew id>/projects/<project folder>/<session id>.jsonl.gz
 *   <stateDir>/crew-archive/<repo key>/<crew id>/projects/<project folder>/<session id>/…/<file>.gz
 *
 * Each file is gzipped on its own and keeps its last-write time, so `projects/` is Claude Code's
 * own layout with `.gz` added, and the readers that count usage and flow read it as a second
 * projects folder (`archive-read.ts`). The project folder goes too once it is empty. Why not
 * delete at once: the conversation is the only record of why a crew session did what it did.
 *
 * **After `workflow.crew.archiveDays`** (7 by default) an archive is deleted: whenever the kit
 * archives, and when `sessions --finished --remove` runs. No timer, no service.
 *
 * **Never taken** (`.claude/rules/setup-and-managed-files.md`: never take what is not ours): a
 * lead's session (any lead record's, any crew record's lead), a session a crew record that is not
 * removed names, a session a running Claude process holds, and every file the store does not
 * name — another session in the same project folder keeps that folder. Only regular files move;
 * a link or anything else stays, and so does the folder around it. A file written while it is
 * archived stays where it is, and so does every file after it.
 *
 * Each file is written to a temporary name, synced and renamed into place before its original is
 * deleted: a move that stops halfway leaves every file in one place or the other (or, for a
 * moment, both: the readers count it once), and the next removal or sweep finishes it.
 */
import {
  closeSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  utimesSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { z } from "zod";
import type { CliPaths } from "../cli/paths";
import { loadProjectConfig, locateCheckout } from "../project/resolve";
import { isSessionId } from "../sessions/saved-sessions";
import { resolveWorkflow } from "../workflow/resolve";
import { repoKey } from "../workflow/reviews";
import { ARCHIVE_PROJECTS, crewArchiveRoot } from "./archive-read";
import type { Env } from "./context";
import { type CrewRecord, listAllCrew, listAllLeads, writeStoreFile } from "./store";
import { transcriptFile } from "./transcript";

/** The schema version of `archive.json`. */
export const CREW_ARCHIVE_VERSION = 1;

/** One day, in ms: `crew.archiveDays` counts whole days. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** The file in each archive that says who it was. */
export const ARCHIVE_MANIFEST = "archive.json";

/** The copy of the crew session's hand-back report, beside its conversation. */
export const ARCHIVE_REPORT = "report.json";

/** The states whose record is gone from the board: only their conversations are taken. */
export const ARCHIVED_STATES: readonly string[] = ["removed", "discarded"];

/** One crew session's archive: `<stateDir>/crew-archive/<repo key>/<crew id>`. */
export function crewArchiveDir(stateDir: string, repo: string, crewId: string): string {
  return join(crewArchiveRoot(stateDir), repoKey(repo), crewId);
}

const manifestSchema = z.looseObject({
  version: z.number().int().min(1),
  crew: z.string().min(1),
  name: z.string().min(1),
  repo: z.string().min(1),
  sessionId: z.string().min(1),
  /** The project folder's name under `projects/`, as Claude Code named it. */
  projectFolder: z.string().min(1),
  archivedAt: z.iso.datetime(),
});
export type ArchiveManifest = z.infer<typeof manifestSchema>;

/** One archive's `archive.json`; null when it is not there or not one. */
export function readArchiveManifest(dir: string): ArchiveManifest | null {
  try {
    const parsed = manifestSchema.safeParse(
      JSON.parse(readFileSync(join(dir, ARCHIVE_MANIFEST), "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    // Not there, or not JSON: an archive the kit cannot name.
    return null;
  }
}

/** What of a session's conversation is in the projects folder. */
export interface Conversation {
  /** Its project folder: `<config>/projects/<project folder>`. */
  projectDir: string;
  /** Its regular files, relative to `projectDir`: the session's folder first, its own transcript last. */
  files: string[];
}

/** Every regular file under `folder`, relative to it, sorted; links and the rest are left out. */
function regularFiles(folder: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      // Not there, or not readable: nothing here moves.
      return;
    }
    for (const name of names) {
      const path = join(dir, name);
      const stat = lstatSync(path, { throwIfNoEntry: false });
      if (stat?.isDirectory()) walk(path);
      else if (stat?.isFile()) out.push(relative(folder, path));
    }
  };
  walk(folder);
  return out;
}

/**
 * The conversation of the session `sessionId` that worked in `worktree`, as Claude Code saved it
 * (`transcriptFile`, the one home of the project folder's name).
 */
export function conversationOf(
  projectsDir: string,
  worktree: string,
  sessionId: string,
): Conversation {
  const file = transcriptFile(projectsDir, worktree, sessionId);
  const projectDir = dirname(file);
  const files = regularFiles(join(projectDir, sessionId)).map((one) => join(sessionId, one));
  if (lstatSync(file, { throwIfNoEntry: false })?.isFile()) files.push(basename(file));
  return { projectDir, files };
}

/**
 * The sessions the archive never takes: every lead's (each lead record's, and each crew record's
 * lead), and the session of each crew record that is not removed — but `exceptCrew`'s, the one
 * being removed. Throws when a record of the store cannot be read: then nobody can say whose a
 * session is, and nothing is taken.
 */
export function sessionsNeverTaken(stateDir: string, exceptCrew: null | string): Set<string> {
  const crew = listAllCrew(stateDir);
  const leads = listAllLeads(stateDir);
  if (crew.broken.length > 0 || leads.broken.length > 0) {
    throw new Error("a crew or lead record of the store cannot be read");
  }
  const kept = new Set<string>();
  for (const lead of leads.records) kept.add(lead.sessionId);
  for (const record of crew.records) {
    kept.add(record.leadSessionId);
    const archived = ARCHIVED_STATES.includes(record.state) || record.id === exceptCrew;
    if (!archived && record.sessionId !== null) kept.add(record.sessionId);
  }
  return kept;
}

/** What archiving one crew session's conversation came to. */
export type ArchiveOutcome =
  /** Nothing of it is in the projects folder (any empty project folder went). */
  | { kind: "nothing"; folderGone: boolean }
  /** It stays where it is, and why. */
  | { kind: "kept"; why: string }
  | { kind: "archived"; dir: string; files: number; folderGone: boolean }
  /** It stopped: `moved` files went before it did; the rest stays where it was. */
  | { kind: "failed"; why: string; moved: number };

export interface ArchiveInput {
  paths: Pick<CliPaths, "projectsDir" | "stateDir">;
  record: CrewRecord;
  /** `sessionsNeverTaken`. */
  neverTaken: ReadonlySet<string>;
  /** The sessions a running Claude process holds (`liveSessions`). */
  running: ReadonlySet<string>;
  nowMs: number;
}

/** Removes `folder` when it is empty; whether it is gone. Never removes anything in it. */
export function removeEmptyFolder(folder: string): boolean {
  try {
    rmdirSync(folder);
    return true;
  } catch {
    // Not empty (another session's files, a link), or not there: it stays as it is.
    return !existsSync(folder);
  }
}

/** Removes the empty folders under `folder`, deepest first, and `folder` when it is empty then. */
function removeEmptyTree(folder: string): void {
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    // Not there: nothing to remove.
    return;
  }
  for (const name of names) {
    const path = join(folder, name);
    if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory()) removeEmptyTree(path);
  }
  removeEmptyFolder(folder);
}

/** Gzips `from` into `to`: a temporary name first, synced, then renamed, mode 0600. */
async function gzipInto(from: string, to: string): Promise<void> {
  const temporary = `${to}.${String(process.pid)}.tmp`;
  try {
    await pipeline(
      createReadStream(from),
      createGzip(),
      createWriteStream(temporary, { mode: 0o600 }),
    );
    const fd = openSync(temporary, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, to);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Moves the conversation of `record`'s session into its archive. Call it only once `claude rm`
 * has removed the session, or for a record that is removed already. Never throws: what went
 * wrong is the outcome's `why`.
 */
export async function archiveConversation(input: ArchiveInput): Promise<ArchiveOutcome> {
  const { paths, record } = input;
  const sessionId = record.sessionId;
  if (sessionId === null || !isSessionId(sessionId)) return { folderGone: false, kind: "nothing" };
  if (input.neverTaken.has(sessionId)) {
    return {
      kind: "kept",
      why: "a lead, or a crew session still on the board, holds that session",
    };
  }
  if (input.running.has(sessionId)) {
    return { kind: "kept", why: "a running Claude session holds it" };
  }
  let moved = 0;
  try {
    const found = conversationOf(paths.projectsDir, record.worktree, sessionId);
    if (found.files.length === 0) {
      return { folderGone: removeEmptyFolder(found.projectDir), kind: "nothing" };
    }
    const dir = crewArchiveDir(paths.stateDir, record.repo, record.id);
    const into = join(dir, ARCHIVE_PROJECTS, basename(found.projectDir));
    mkdirSync(into, { mode: 0o700, recursive: true });
    // Written first, so an archive that stops halfway still says whose it is and when it began.
    const manifest: ArchiveManifest = {
      archivedAt: new Date(input.nowMs).toISOString(),
      crew: record.id,
      name: record.name,
      projectFolder: basename(found.projectDir),
      repo: record.repo,
      sessionId,
      version: CREW_ARCHIVE_VERSION,
    };
    writeStoreFile(join(dir, ARCHIVE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    if (record.reportPath !== null && existsSync(record.reportPath)) {
      copyFileSync(record.reportPath, join(dir, ARCHIVE_REPORT));
    }
    for (const file of found.files) {
      const from = join(found.projectDir, file);
      const to = `${join(into, file)}.gz`;
      mkdirSync(dirname(to), { mode: 0o700, recursive: true });
      const before = lstatSync(from);
      await gzipInto(from, to);
      utimesSync(to, before.atime, before.mtime);
      const after = lstatSync(from);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        rmSync(to, { force: true });
        return {
          kind: "failed",
          moved,
          why: `${file} was written while it was archived, so it stays where it is`,
        };
      }
      unlinkSync(from);
      moved += 1;
    }
    removeEmptyTree(join(found.projectDir, sessionId));
    return { dir, files: moved, folderGone: removeEmptyFolder(found.projectDir), kind: "archived" };
  } catch (error) {
    return { kind: "failed", moved, why: reasonOf(error) };
  }
}

/** One archive the prune deleted, or would delete. */
export interface PrunedArchive {
  dir: string;
  /** The crew session's name; its folder's name when its `archive.json` cannot be read. */
  name: string;
  ageMs: number;
}

/** What a prune came to. */
export interface PruneOutcome {
  pruned: PrunedArchive[];
  /** Archives kept because their days cannot be read, or their folder would not go, with why. */
  kept: Array<{ dir: string; why: string }>;
}

/**
 * Deletes every archive older than its repository's `crew.archiveDays` (`daysOf`, null when the
 * setting cannot be read: then the archive stays). Its age counts from `archivedAt`, else from
 * its folder's last change. `dryRun` deletes nothing and says what would go. The folders are the
 * kit's own: a link where a folder should be is never followed.
 */
export function pruneCrewArchives(
  stateDir: string,
  daysOf: (repo: null | string) => null | number,
  nowMs: number,
  dryRun = false,
): PruneOutcome {
  const outcome: PruneOutcome = { kept: [], pruned: [] };
  const root = crewArchiveRoot(stateDir);
  const folders = (dir: string) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(dir, entry.name))
        .sort();
    } catch {
      // No archive yet: nothing to prune.
      return [];
    }
  };
  for (const repoDir of folders(root)) {
    for (const dir of folders(repoDir)) {
      const manifest = readArchiveManifest(dir);
      const days = daysOf(manifest?.repo ?? null);
      if (days === null) {
        outcome.kept.push({ dir, why: "its repository's crew.archiveDays cannot be read" });
        continue;
      }
      const at = manifest === null ? lstatSync(dir).mtimeMs : Date.parse(manifest.archivedAt);
      const ageMs = nowMs - at;
      if (!(ageMs > days * DAY_MS)) continue;
      const pruned = { ageMs, dir, name: manifest?.name ?? basename(dir) };
      if (dryRun) {
        outcome.pruned.push(pruned);
        continue;
      }
      try {
        rmSync(dir, { force: true, recursive: true });
        outcome.pruned.push(pruned);
      } catch (error) {
        outcome.kept.push({ dir, why: reasonOf(error) });
      }
    }
    if (!dryRun) removeEmptyFolder(repoDir);
  }
  return outcome;
}

/**
 * `crew.archiveDays` of each repository, read once per repository: its project's file over the
 * person's own, else the default. Null for a repository whose settings cannot be read.
 */
export function archiveDaysOf(paths: CliPaths, env: Env): (repo: null | string) => null | number {
  const known = new Map<null | string, null | number>();
  return (repo) => {
    const had = known.get(repo);
    if (had !== undefined) return had;
    let days: null | number;
    try {
      const checkout = repo === null ? null : locateCheckout(repo, { env });
      const config = checkout === null ? null : loadProjectConfig(checkout).config;
      days = resolveWorkflow(paths, config).crew.archiveDays.value;
    } catch {
      // A settings file that cannot be read: the archive stays until it can.
      days = null;
    }
    known.set(repo, days);
    return days;
  };
}
