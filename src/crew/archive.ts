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
 * projects folder (`archive-read.ts`). The project folder goes too once it holds nothing. Why not
 * delete at once: the conversation is the only record of why a crew session did what it did.
 *
 * **After `workflow.crew.archiveDays`** (7 by default) an archive is deleted: whenever the kit
 * archives, and when `sessions --finished --remove` runs. No timer, no service.
 *
 * **Never taken** (`.claude/rules/setup-and-managed-files.md`: never take what is not ours): a
 * lead's session (any lead record's, any crew record's lead), a session a crew record that is not
 * removed names, a session a running Claude process holds, and every file the store does not
 * name — another session in the same project folder keeps that folder. Only regular files move;
 * a link or anything else stays, and so does the folder around it; a session folder that is
 * itself a link is not followed. A file written while it is archived stays where it is.
 *
 * **One run at a time.** Every move and every prune holds one lock on the archive folder
 * (`withArchiveLock`), and a move reads the conversation again once it holds it: two runs on the
 * same record (the watch's removal and a `crew rm`, the background clean and a sweep) take turns,
 * and the second finds nothing left.
 *
 * **Nothing is lost on the way.** Each file is written to a temporary name, synced and renamed into
 * place before its original is deleted: a move that stops halfway leaves every file in one place
 * or the other (or, for a moment, both: the readers count it once), and the next removal or sweep
 * finishes it. An archived copy is never overwritten: a file whose archived copy has other bytes (a
 * job that kept running wrote it again, seen live) stays where it is, nothing of that conversation
 * moves, and the reason is said. A copy is deleted only when its source is still there and has
 * changed: a source that is gone keeps its copy.
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
  type Stats,
  unlinkSync,
  utimesSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip, gunzipSync } from "node:zlib";
import { z } from "zod";
import type { CliPaths } from "../cli/paths";
import { loadProjectConfig, locateCheckout } from "../project/resolve";
import { isSessionId } from "../sessions/saved-sessions";
import { withLock } from "../setup/lock";
import { resolveWorkflow } from "../workflow/resolve";
import { repoKey } from "../workflow/reviews";
import { ARCHIVE_PROJECTS, crewArchiveRoot } from "./archive-read";
import type { Env } from "./context";
import { type CrewRecord, crewSessions, listAllCrew, listAllLeads, writeStoreFile } from "./store";
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

/** How long a move or a prune waits for another run that holds the archive: a large conversation takes seconds to zip. */
export const ARCHIVE_LOCK_WAIT_MS = 30_000;

/** One crew session's archive: `<stateDir>/crew-archive/<repo key>/<crew id>`. */
export function crewArchiveDir(stateDir: string, repo: string, crewId: string): string {
  return join(crewArchiveRoot(stateDir), repoKey(repo), crewId);
}

/**
 * Runs `work` holding the lock on the whole archive folder (`<stateDir>/crew-archive`): the one
 * place a move and a prune take turns. Throws `LockBusyError` when another run still holds it
 * after `waitMs`.
 */
export async function withArchiveLock<T>(
  stateDir: string,
  work: () => Promise<T> | T,
  waitMs: number = ARCHIVE_LOCK_WAIT_MS,
): Promise<T> {
  const root = crewArchiveRoot(stateDir);
  mkdirSync(root, { mode: 0o700, recursive: true });
  return await withLock(root, work, { waitMs });
}

// A function, not a constant: the hook bundles reach this module through the crew modules, and a
// schema built at load would cost every hook run (and pull in zod's `iso`) for a file only the
// archive commands read.
const manifestSchema = () =>
  z.looseObject({
    version: z.number().int().min(1),
    crew: z.string().min(1),
    name: z.string().min(1),
    repo: z.string().min(1),
    sessionId: z.string().min(1),
    /** The project folder's name under `projects/`, as Claude Code named it. */
    projectFolder: z.string().min(1),
    archivedAt: z.iso.datetime(),
  });
export type ArchiveManifest = z.infer<ReturnType<typeof manifestSchema>>;

/** One archive's `archive.json`; null when it is not there or not one. */
export function readArchiveManifest(dir: string): ArchiveManifest | null {
  try {
    const parsed = manifestSchema().safeParse(
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
 * (`transcriptFile`, the one home of the project folder's name). The session's folder counts only
 * when it is a real folder: a link there is someone's own, and is not followed.
 */
export function conversationOf(
  projectsDir: string,
  worktree: string,
  sessionId: string,
): Conversation {
  const file = transcriptFile(projectsDir, worktree, sessionId);
  const projectDir = dirname(file);
  const sessionDir = join(projectDir, sessionId);
  const files = lstatSync(sessionDir, { throwIfNoEntry: false })?.isDirectory()
    ? regularFiles(sessionDir).map((one) => join(sessionId, one))
    : [];
  if (lstatSync(file, { throwIfNoEntry: false })?.isFile()) files.push(basename(file));
  return { projectDir, files };
}

/**
 * The sessions the archive never takes: every lead's (each lead record's, and each crew record's
 * lead), and every session (`crewSessions`: the current and the earlier ones) of each crew record
 * that is not removed — but `exceptCrew`'s, the one being removed. Throws when a record of the store cannot be read: then nobody can say whose a
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
    if (!archived) for (const one of crewSessions(record)) kept.add(one.sessionId);
  }
  return kept;
}

/** What archiving one crew session's conversation came to. */
export type ArchiveOutcome =
  /** Nothing of it is in the projects folder (any empty project folder went). */
  | { kind: "nothing"; folderGone: boolean }
  /** It stays where it is, and why. */
  | { kind: "kept"; why: string }
  | {
      kind: "archived";
      dir: string;
      files: number;
      folderGone: boolean;
      /** Why a session of the same crew session stayed (a record of several sessions); absent when none did. */
      stayed?: string[];
    }
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
  /** How long to wait for another run that holds the archive; `ARCHIVE_LOCK_WAIT_MS` by default. */
  lockWaitMs?: number;
}

/**
 * Whether `folder` is a folder that holds nothing but folders that hold nothing. Claude Code
 * leaves an empty `memory/` folder in a project folder (seen live, 2.1.310), so "empty" has to
 * mean that too. A file, a link or anything else is something, and a folder that cannot be read
 * holds something as far as anyone can tell.
 */
export function holdsNothing(folder: string): boolean {
  const stat = lstatSync(folder, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isDirectory()) return false;
  try {
    return readdirSync(folder).every((name) => holdsNothing(join(folder, name)));
  } catch {
    // Not readable: it may hold something.
    return false;
  }
}

/**
 * Removes the empty folders under `folder`, deepest first, and `folder` when it is empty then.
 * Only a real folder: a link is not followed, so nothing outside is touched.
 */
function removeEmptyTree(folder: string): void {
  if (!lstatSync(folder, { throwIfNoEntry: false })?.isDirectory()) return;
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    // Not readable: nothing to remove.
    return;
  }
  for (const name of names) removeEmptyTree(join(folder, name));
  try {
    rmdirSync(folder);
  } catch {
    // Something is left in it (a file, a link, a folder that would not go): it stays as it is.
  }
}

/**
 * Removes `folder` when it holds nothing (`holdsNothing`: empty, or only empty folders); whether
 * it is gone. Never removes a file, a link or a folder that holds one.
 */
export function removeEmptyFolder(folder: string): boolean {
  if (holdsNothing(folder)) removeEmptyTree(folder);
  return !existsSync(folder);
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

/** What a source file came to between reading it and looking again. */
export type SourceAfterCopy = "changed" | "gone" | "same";

/**
 * What a copy made from the file that read as `before` should do now that the file reads as
 * `after` (undefined: it is gone). `same`: delete the source, the copy is whole. `changed`: the
 * file grew or was replaced while it was copied, so the copy is stale and goes. `gone`: someone
 * else moved or deleted the source, which says nothing against the copy, so it stays — the one
 * rule that keeps a move from losing both.
 */
export function sourceAfterCopy(
  after: Pick<Stats, "mtimeMs" | "size"> | undefined,
  before: Pick<Stats, "mtimeMs" | "size">,
): SourceAfterCopy {
  if (after === undefined) return "gone";
  return after.size === before.size && after.mtimeMs === before.mtimeMs ? "same" : "changed";
}

/** Whether the file `from` was written, replaced or removed since `before` was read. */
function changedSince(from: string, before: Stats): boolean {
  return sourceAfterCopy(lstatSync(from, { throwIfNoEntry: false }), before) !== "same";
}

/** Deletes a file; one that is gone already is what was wanted. */
function removeFile(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Whether the archived copy `to` unzips to exactly the bytes of `from`; false when it cannot be read. */
function sameAsArchived(from: string, to: string): boolean {
  try {
    return readFileSync(from).equals(gunzipSync(readFileSync(to)));
  } catch {
    // Not whole (a copy cut short) or not readable: it is not the same file.
    return false;
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The first file of `found` whose archived copy is there with other bytes, else null: a job that
 * kept running wrote the file again after the move (seen live). Neither copy is then touched. The
 * archive and the sweep ask it before they move or list anything.
 */
export function differingArchivedCopy(
  paths: Pick<CliPaths, "stateDir">,
  record: CrewRecord,
  found: Conversation,
): string | null {
  const into = join(
    crewArchiveDir(paths.stateDir, record.repo, record.id),
    ARCHIVE_PROJECTS,
    basename(found.projectDir),
  );
  for (const file of found.files) {
    const to = `${join(into, file)}.gz`;
    if (existsSync(to) && !sameAsArchived(join(found.projectDir, file), to)) return file;
  }
  return null;
}

/**
 * Moves the conversations of every session of `record` (`crewSessions`: a resume is a copy with a
 * new id, WF1, so a record can have several) into its archive. Call it only once `claude rm` has
 * removed the sessions, or for a record that is removed already. Never throws: what went wrong is
 * the outcome's `why`. One outcome for the whole record: a failure wins, then what moved; a
 * session that stayed beside one that moved is told in `stayed`.
 */
export async function archiveConversation(input: ArchiveInput): Promise<ArchiveOutcome> {
  const ids = crewSessions(input.record)
    .map((one) => one.sessionId)
    .filter(isSessionId);
  let archived: Extract<ArchiveOutcome, { kind: "archived" }> | undefined;
  let kept: string | undefined;
  let nothing: Extract<ArchiveOutcome, { kind: "nothing" }> = {
    folderGone: false,
    kind: "nothing",
  };
  let moved = 0;
  for (const sessionId of ids) {
    const one = await archiveSession(input, sessionId);
    if (one.kind === "failed") return { ...one, moved: moved + one.moved };
    if (one.kind === "archived") {
      moved += one.files;
      archived = { ...one, files: moved };
    } else if (one.kind === "kept") {
      kept ??= one.why;
    } else {
      nothing = one;
    }
  }
  if (archived !== undefined) {
    return {
      ...archived,
      folderGone: archived.folderGone || nothing.folderGone,
      ...(kept === undefined ? {} : { stayed: [kept] }),
    };
  }
  return kept === undefined ? nothing : { kind: "kept", why: kept };
}

/** One session's conversation into the archive. */
async function archiveSession(input: ArchiveInput, sessionId: string): Promise<ArchiveOutcome> {
  const { paths, record } = input;
  if (input.neverTaken.has(sessionId)) {
    return {
      kind: "kept",
      why: "a lead, or a crew session still on the board, holds that session",
    };
  }
  if (input.running.has(sessionId)) {
    return { kind: "kept", why: "a running Claude session holds it" };
  }
  try {
    // A look before the lock, so a conversation that is not there takes no lock and makes no folder.
    const first = conversationOf(paths.projectsDir, record.worktree, sessionId);
    if (first.files.length === 0) {
      return { folderGone: removeEmptyFolder(first.projectDir), kind: "nothing" };
    }
    return await withArchiveLock(
      paths.stateDir,
      () => moveConversation(input, sessionId),
      input.lockWaitMs,
    );
  } catch (error) {
    return { kind: "failed", moved: 0, why: reasonOf(error) };
  }
}

/** The move itself; the caller holds the archive lock. */
async function moveConversation(input: ArchiveInput, sessionId: string): Promise<ArchiveOutcome> {
  const { paths, record } = input;
  let moved = 0;
  try {
    // Read again now that this run holds the archive: another run may have moved it meanwhile.
    const found = conversationOf(paths.projectsDir, record.worktree, sessionId);
    if (found.files.length === 0) {
      return { folderGone: removeEmptyFolder(found.projectDir), kind: "nothing" };
    }
    const differing = differingArchivedCopy(paths, record, found);
    if (differing !== null) {
      return {
        kind: "kept",
        why: `${differing} differs from its archived copy, so neither is overwritten`,
      };
    }
    const dir = crewArchiveDir(paths.stateDir, record.repo, record.id);
    const into = join(dir, ARCHIVE_PROJECTS, basename(found.projectDir));
    mkdirSync(into, { mode: 0o700, recursive: true });
    // Written first, so an archive that stops halfway still says whose it is and when it began —
    // and once: a later try does not make the archive younger.
    if (readArchiveManifest(dir) === null) {
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
    }
    if (record.reportPath !== null && existsSync(record.reportPath)) {
      copyFileSync(record.reportPath, join(dir, ARCHIVE_REPORT));
    }
    for (const file of found.files) {
      const from = join(found.projectDir, file);
      const to = `${join(into, file)}.gz`;
      mkdirSync(dirname(to), { mode: 0o700, recursive: true });
      const before = lstatSync(from);
      if (existsSync(to)) {
        // A move that stopped before it deleted the original: the archived copy has these bytes
        // (`differingArchivedCopy`), so finishing it is deleting the original — if it still is.
        if (!sameAsArchived(from, to) || changedSince(from, before)) {
          return {
            kind: "failed",
            moved,
            why: `${file} changed while it was checked against its archived copy, so it stays where it is`,
          };
        }
        removeFile(from);
        moved += 1;
        continue;
      }
      await gzipInto(from, to);
      utimesSync(to, before.atime, before.mtime);
      const verdict = sourceAfterCopy(lstatSync(from, { throwIfNoEntry: false }), before);
      if (verdict === "changed") {
        rmSync(to, { force: true });
        return {
          kind: "failed",
          moved,
          why: `${file} was written while it was archived, so it stays where it is`,
        };
      }
      // `gone`: someone else took the source, which is what the delete wanted anyway.
      removeFile(from);
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

/** The folders directly under `dir`, sorted; none when it is not there. Links are not folders here. */
function foldersUnder(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name))
      .sort();
  } catch {
    // No archive yet: nothing in it.
    return [];
  }
}

/**
 * The archives older than their repository's `crew.archiveDays` (`daysOf`; null when the setting
 * cannot be read, and then the archive stays). Read only: `pruned` is what a prune would delete.
 * Its age counts from `archivedAt`, else from its folder's last change.
 */
export function expiredArchives(
  stateDir: string,
  daysOf: (repo: null | string) => null | number,
  nowMs: number,
): PruneOutcome {
  const outcome: PruneOutcome = { kept: [], pruned: [] };
  for (const repoDir of foldersUnder(crewArchiveRoot(stateDir))) {
    for (const dir of foldersUnder(repoDir)) {
      const manifest = readArchiveManifest(dir);
      const days = daysOf(manifest?.repo ?? null);
      if (days === null) {
        outcome.kept.push({ dir, why: "its repository's crew.archiveDays cannot be read" });
        continue;
      }
      // A folder another run deleted meanwhile has nothing left to expire.
      const changed = lstatSync(dir, { throwIfNoEntry: false })?.mtimeMs;
      const at = manifest === null ? changed : Date.parse(manifest.archivedAt);
      if (at === undefined) continue;
      const ageMs = nowMs - at;
      if (ageMs > days * DAY_MS)
        outcome.pruned.push({ ageMs, dir, name: manifest?.name ?? basename(dir) });
    }
  }
  return outcome;
}

/**
 * Deletes every archive older than its repository's `crew.archiveDays` (`expiredArchives`),
 * holding the archive lock: a prune and a move never run together. The folders are the kit's own;
 * a link where a folder should be is never followed. Throws `LockBusyError` when another run holds
 * the archive past `options.lockWaitMs`.
 */
export async function pruneCrewArchives(
  stateDir: string,
  daysOf: (repo: null | string) => null | number,
  nowMs: number,
  options: { lockWaitMs?: number } = {},
): Promise<PruneOutcome> {
  if (!existsSync(crewArchiveRoot(stateDir))) return { kept: [], pruned: [] };
  return await withArchiveLock(
    stateDir,
    () => {
      const found = expiredArchives(stateDir, daysOf, nowMs);
      const outcome: PruneOutcome = { kept: found.kept, pruned: [] };
      for (const one of found.pruned) {
        try {
          rmSync(one.dir, { force: true, recursive: true });
          outcome.pruned.push(one);
        } catch (error) {
          outcome.kept.push({ dir: one.dir, why: reasonOf(error) });
        }
      }
      for (const repoDir of foldersUnder(crewArchiveRoot(stateDir))) removeEmptyFolder(repoDir);
      return outcome;
    },
    options.lockWaitMs,
  );
}

/**
 * `crew.archiveDays` of each repository, read once per repository: its project's file over the
 * person's own, else the default. A repository whose folder is gone (moved or deleted) has no
 * project file to read, and its archives expire by the person's own days like any other. Null
 * only for a settings file that is there and cannot be read: that archive stays until it can.
 */
export function archiveDaysOf(paths: CliPaths, env: Env): (repo: null | string) => null | number {
  const known = new Map<null | string, null | number>();
  return (repo) => {
    const had = known.get(repo);
    if (had !== undefined) return had;
    let days: null | number;
    try {
      const checkout = repo === null || !existsSync(repo) ? null : locateCheckout(repo, { env });
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
