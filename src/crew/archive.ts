/**
 * A crew session's conversation leaves Claude Code's `/resume` list on a timeline (AR1, D69).
 *
 * `claude rm <short id>` deletes a background session's job and its worktree, never its
 * conversation: `<config>/projects/<project folder>/<session id>.jsonl` and the `<session id>/`
 * folder beside it (its subagents' transcripts, its tool results) stay, and `/resume` lists them
 * for ever. Claude Code's own `cleanupPeriodDays` cannot help: it deletes every conversation older
 * than its days, the person's own too.
 *
 * So once a crew session's session has ended — the kit released it (D69) or removed it, and
 * `claude rm` succeeded — the record carries `sessionEndedAt`, and **`workflow.crew.archiveDays`
 * (7 by default) after that end** its conversation moves into the kit's own state:
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
 * **`workflow.crew.deleteDays` (30 by default) after the same end** the archive is deleted.
 * One sweep does both (`sweepCrewConversations`): the lead's watch, at most once an hour, and
 * `sessions --finished --remove`. No timer, no service. A resume puts an archived conversation
 * back first (`restoreConversation`), and a record that works again starts a new timeline.
 *
 * **Never taken** (`.claude/rules/setup-and-managed-files.md`: never take what is not ours): a
 * lead's session (any lead record's, any crew record's lead), a session of a crew record whose
 * session has not ended (`sessionsNeverTaken`), a session a running Claude process holds, a file
 * written after that end, and every file the store does not
 * name — another session in the same project folder keeps that folder. Only regular files move;
 * a link or anything else stays, and so does the folder around it; a session folder that is
 * itself a link is not followed. A file written while it is archived stays where it is.
 *
 * **One run at a time.** Every move and every prune holds one lock on the archive folder
 * (`withArchiveLock`), and a move reads the conversation again once it holds it: two runs on the
 * same record (two watches' sweeps, a sweep and a resume's restore) take turns,
 * and the second finds nothing left.
 *
 * **Nothing is lost on the way.** Each file is written to a temporary name, synced and renamed into
 * place before its original is deleted: a move that stops halfway leaves every file in one place
 * or the other (or, for a moment, both: the readers count it once), and the next sweep finishes
 * it. An archived copy is never overwritten: a file whose archived copy has other bytes (a
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
  linkSync,
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
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip, gunzipSync } from "node:zlib";
import { z } from "zod";
import type { CliPaths } from "../cli/paths";
import { liveSessions } from "../hooks/sessions";
import { loadProjectConfig, locateCheckout } from "../project/resolve";
import { isSessionId } from "../sessions/saved-sessions";
import { withLock } from "../setup/lock";
import { resolveWorkflow } from "../workflow/resolve";
import { repoKey } from "../workflow/reviews";
import { ARCHIVE_PROJECTS, crewArchiveRoot } from "./archive-read";
import type { Env } from "./context";
import { RELEASE_STATES } from "./lifecycle";
import {
  type CrewRecord,
  crewSessions,
  listAllCrew,
  listAllLeads,
  readCrewEvents,
  writeStoreFile,
} from "./store";
import { transcriptFile } from "./transcript";

/** A crew session's conversation still in Claude Code's projects folder, due for the archive. */
export interface LeftConversation {
  record: CrewRecord;
  /** Its files there: the transcript, its subagents' and its tool results. */
  files: number;
  projectDir: string;
  /** The sessions of the record that passed every check; the move takes these and no others. */
  sessionIds: string[];
}

/**
 * What the timeline finds (D69): the conversations due for the archive, the empty project folders
 * of crew worktrees, the conversations that stay and why (one not yet due names its date), the
 * archives past their delete date, and the delete date of every other archive. What
 * `sessions --finished` lists and `--remove` sweeps; machine-wide, like the finished sessions.
 */
export interface CrewLeftovers {
  conversations: LeftConversation[];
  emptyFolders: string[];
  kept: Array<{ record: CrewRecord; why: string }>;
  expired: PrunedArchive[];
  scheduled?: Array<{ name: string; deleteAt: string }>;
  error: string | null;
}

/**
 * When each record's session ended: its `sessionEndedAt`; a record from before the field falls
 * back to the event that removed it (the store's own log, read once per repository when first
 * asked), then to its last write.
 */
export function removalTimes(stateDir: string): { at: (record: CrewRecord) => number } {
  const cache = new Map<string, Map<string, number>>();
  return {
    at(record) {
      if (record.sessionEndedAt !== undefined) return Date.parse(record.sessionEndedAt);
      let times = cache.get(record.repo);
      if (times === undefined) {
        times = new Map();
        for (const event of readCrewEvents(stateDir, record.repo).events) {
          if (event.type !== "state" || !ARCHIVED_STATES.includes(event.state)) continue;
          const at = Date.parse(event.at);
          if (Number.isFinite(at))
            times.set(event.crew, Math.min(times.get(event.crew) ?? Infinity, at));
        }
        cache.set(record.repo, times);
      }
      return times.get(record.id) ?? Date.parse(record.updatedAt);
    },
  };
}

/**
 * Reads the timeline, read only: only records whose session ended (removed, discarded, or an
 * over record with `sessionEndedAt`), never a lead's session, one a record still at work names,
 * or one a running Claude holds; a conversation written after that end was resumed since, and
 * stays. A store or a session record it cannot read fails closed: nothing is listed, so nothing
 * moves.
 */
export function readCrewLeftovers(paths: CliPaths, deps: { env: Env; now: number }): CrewLeftovers {
  const out: CrewLeftovers = {
    conversations: [],
    emptyFolders: [],
    kept: [],
    expired: [],
    error: null,
  };
  try {
    const crew = listAllCrew(paths.stateDir);
    if (crew.broken.length)
      throw new Error(
        "Could not read every crew record; repair the crew store before moving them.",
      );
    const never = sessionsNeverTaken(paths.stateDir, null);
    const running = new Set(liveSessions(paths.claudeConfigDir).map((one) => one.sessionId));
    const times = removalTimes(paths.stateDir);
    const daysOf = archiveDaysOf(paths, deps.env);
    for (const record of crew.records) {
      if (!ARCHIVED_STATES.includes(record.state) && record.sessionEndedAt === undefined) continue;
      const keep = (why: string) => {
        if (!out.kept.some((one) => one.record.id === record.id && one.why === why))
          out.kept.push({ record, why });
      };
      for (const { sessionId } of crewSessions(record)) {
        if (sessionId === null || !isSessionId(sessionId) || never.has(sessionId)) continue;
        const found = conversationOf(paths.projectsDir, record.worktree, sessionId);
        if (!found.files.length) {
          if (holdsNothing(found.projectDir) && !out.emptyFolders.includes(found.projectDir))
            out.emptyFolders.push(found.projectDir);
          continue;
        }
        if (running.has(sessionId)) {
          keep("a running Claude session holds it");
          continue;
        }
        const differing = differingArchivedCopy(paths, record, found);
        if (differing !== null) {
          keep(`${differing} differs from its archived copy, so neither is overwritten`);
          continue;
        }
        const at = times.at(record);
        if (found.files.some((file) => lstatSync(join(found.projectDir, file)).mtimeMs > at)) {
          keep("it was written after its crew session was removed");
          continue;
        }
        const days = daysOf(record.repo);
        if (days === null || deps.now < at + days * DAY_MS) {
          keep(
            days === null
              ? "its archive days cannot be read"
              : `moves to the archive ${new Date(at + days * DAY_MS).toISOString()}`,
          );
          continue;
        }
        const listed = out.conversations.find(
          (one) => one.record.id === record.id && one.record.repo === record.repo,
        );
        if (listed) {
          listed.files += found.files.length;
          listed.sessionIds.push(sessionId);
        } else
          out.conversations.push({
            record,
            files: found.files.length,
            projectDir: found.projectDir,
            sessionIds: [sessionId],
          });
      }
    }
    const deleteOf = deleteDaysOf(paths, deps.env);
    out.expired = expiredArchives(paths.stateDir, deleteOf, deps.now).pruned;
    out.scheduled = [];
    for (const repo of foldersUnder(crewArchiveRoot(paths.stateDir))) {
      for (const dir of foldersUnder(repo)) {
        const manifest = readArchiveManifest(dir);
        if (manifest === null || out.expired.some((one) => one.dir === dir)) continue;
        const record = crew.records.find(
          (one) => one.id === manifest.crew && one.repo === manifest.repo,
        );
        const days = deleteOf(manifest.repo);
        if (days === null) continue;
        const at =
          record === undefined
            ? Date.parse(manifest.sessionEndedAt ?? manifest.archivedAt)
            : times.at(record);
        out.scheduled.push({
          name: manifest.name,
          deleteAt: new Date(at + days * DAY_MS).toISOString(),
        });
      }
    }
  } catch (error) {
    return { conversations: [], emptyFolders: [], kept: [], expired: [], error: reasonOf(error) };
  }
  return out;
}

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
    sessionEndedAt: z.iso.datetime().optional(),
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
 * whose session has not ended — not removed or discarded, and no `sessionEndedAt` on an over
 * record (D69) — but `exceptCrew`'s. Throws when a record of the store cannot be read: then
 * nobody can say whose a session is, and nothing is taken.
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
    const archived =
      ARCHIVED_STATES.includes(record.state) ||
      (record.sessionEndedAt !== undefined && RELEASE_STATES.includes(record.state)) ||
      record.id === exceptCrew;
    if (!archived) {
      for (const one of crewSessions(record)) if (one.sessionId !== null) kept.add(one.sessionId);
    }
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
  /**
   * The sessions to move, when not every session of the record: the sweep judges each session
   * (one written after the removal is the person's) and hands in the ones it passed.
   */
  only?: ReadonlySet<string>;
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
    .filter((one): one is string => one !== null && isSessionId(one))
    .filter((one) => input.only === undefined || input.only.has(one));
  let archived: Extract<ArchiveOutcome, { kind: "archived" }> | undefined;
  const kept: string[] = [];
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
      if (!kept.includes(one.why)) kept.push(one.why);
    } else {
      nothing = one;
    }
  }
  if (archived !== undefined) {
    return {
      ...archived,
      folderGone: archived.folderGone || nothing.folderGone,
      ...(kept.length === 0 ? {} : { stayed: kept }),
    };
  }
  return kept[0] === undefined ? nothing : { kind: "kept", why: kept.join("; ") };
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
        sessionEndedAt: new Date(removalTimes(paths.stateDir).at(record)).toISOString(),
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
      const record =
        manifest === null
          ? undefined
          : listAllCrew(stateDir).records.find(
              (one) => one.id === manifest.crew && one.repo === manifest.repo,
            );
      if (
        record !== undefined &&
        record.sessionEndedAt === undefined &&
        !ARCHIVED_STATES.includes(record.state)
      )
        continue;
      const at =
        record !== undefined
          ? removalTimes(stateDir).at(record)
          : manifest === null
            ? changed
            : Date.parse(manifest.sessionEndedAt ?? manifest.archivedAt);
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
  return timelineDaysOf(paths, env, "archiveDays");
}

export function deleteDaysOf(paths: CliPaths, env: Env): (repo: null | string) => null | number {
  return timelineDaysOf(paths, env, "deleteDays");
}

/**
 * The timeline's one sweep (D69): every conversation due for the archive goes through the same
 * reader `sessions --finished` lists from, then every archive past its delete date goes.
 * `outcomes` holds one entry per conversation it tried (moved, kept or failed); `kept` the ones
 * the reader kept before trying, with why.
 */
export async function sweepCrewConversations(
  paths: CliPaths,
  env: Env,
  now: number,
): Promise<{
  outcomes: Array<{ record: CrewRecord; outcome: ArchiveOutcome }>;
  kept: CrewLeftovers["kept"];
  deleted: PrunedArchive[];
}> {
  const left = readCrewLeftovers(paths, { env, now });
  if (left.error !== null) throw new Error(left.error);
  const neverTaken = sessionsNeverTaken(paths.stateDir, null);
  const running = new Set(liveSessions(paths.claudeConfigDir).map((one) => one.sessionId));
  const outcomes: Array<{ record: CrewRecord; outcome: ArchiveOutcome }> = [];
  for (const one of left.conversations) {
    const outcome = await archiveConversation({
      paths,
      record: one.record,
      nowMs: now,
      neverTaken,
      running,
      only: new Set(one.sessionIds),
    });
    outcomes.push({ record: one.record, outcome });
  }
  for (const folder of left.emptyFolders) removeEmptyFolder(folder);
  const pruned = await pruneCrewArchives(paths.stateDir, deleteDaysOf(paths, env), now);
  return { outcomes, kept: left.kept, deleted: pruned.pruned };
}

/** Restores only this record's archived files, refusing conflicts before writing anything. */
export async function restoreConversation(
  paths: Pick<CliPaths, "stateDir" | "projectsDir">,
  record: CrewRecord,
): Promise<{ ok: true; note?: string } | { ok: false; why: string }> {
  const dir = crewArchiveDir(paths.stateDir, record.repo, record.id);
  if (!existsSync(dir)) return { ok: true };
  try {
    return await withArchiveLock(paths.stateDir, () => {
      const manifest = readArchiveManifest(dir);
      if (manifest === null || manifest.crew !== record.id || manifest.repo !== record.repo)
        throw new Error("the conversation archive has no matching manifest");
      const root = join(dir, ARCHIVE_PROJECTS);
      const ids = new Set(crewSessions(record).map((one) => one.sessionId));
      const inspect = (folder: string): void => {
        if (!lstatSync(folder).isDirectory())
          throw new Error("the archive contains a link or non-regular entry");
        for (const name of readdirSync(folder)) {
          const path = join(folder, name);
          const stat = lstatSync(path);
          if (stat.isDirectory()) inspect(path);
          else if (!stat.isFile())
            throw new Error("the archive contains a link or non-regular entry");
        }
      };
      inspect(dir);
      const prepared = regularFiles(root).map((file) => {
        const parts = file.split(/[\\/]/);
        const folder = parts[0];
        const session = parts[1];
        if (
          folder !== manifest.projectFolder ||
          session === undefined ||
          (!ids.has(session) && !ids.has(session.replace(/\.jsonl\.gz$/, "")))
        ) {
          throw new Error("the archive holds a conversation this record does not own");
        }
        if (!file.endsWith(".gz")) throw new Error("the archive holds a file that is not gzipped");
        const target = join(paths.projectsDir, file.slice(0, -3));
        // Check every parent: a symlink must never redirect a restore outside projects/.
        let parent = dirname(target);
        while (parent !== paths.projectsDir) {
          const stat = lstatSync(parent, { throwIfNoEntry: false });
          if (stat !== undefined && !stat.isDirectory())
            throw new Error(`${parent} is not a regular folder`);
          const next = dirname(parent);
          if (next === parent) throw new Error("the archive path is outside projects");
          parent = next;
        }
        const bytes = gunzipSync(readFileSync(join(root, file)));
        const stat = lstatSync(target, { throwIfNoEntry: false });
        if (stat !== undefined && (!stat.isFile() || !readFileSync(target).equals(bytes)))
          throw new Error(`${target} differs from its archived copy`);
        return { target, bytes, source: join(root, file), exists: stat !== undefined };
      });
      const created: string[] = [];
      const folders: string[] = [];
      const staged: Array<{ temporary: string; target: string }> = [];
      const makeFolder = (folder: string): void => {
        if (existsSync(folder)) return;
        makeFolder(dirname(folder));
        mkdirSync(folder, { mode: 0o700 });
        folders.push(folder);
      };
      try {
        for (const file of prepared) {
          if (file.exists) continue;
          makeFolder(dirname(file.target));
          const temporary = `${file.target}.${process.pid}.restore`;
          const fd = openSync(temporary, "wx", 0o600);
          staged.push({ temporary, target: file.target });
          try {
            writeFileSync(fd, file.bytes);
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
          const stat = lstatSync(file.source);
          utimesSync(temporary, stat.atime, stat.mtime);
        }
        for (const file of staged) {
          // A hard link never replaces a file that appeared since the check above (EEXIST).
          try {
            linkSync(file.temporary, file.target);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST")
              throw new Error(`${file.target} appeared during restore`);
            throw error;
          }
          created.push(file.target);
          removeFile(file.temporary);
        }
      } catch (error) {
        for (const file of staged) removeFile(file.temporary);
        for (const target of created) removeFile(target);
        for (const folder of folders.reverse()) rmdirSync(folder);
        throw error;
      }
      try {
        rmSync(dir, { recursive: true });
      } catch (error) {
        return {
          ok: true as const,
          note: `restored; the archive copy is left: ${reasonOf(error)}`,
        };
      }
      return { ok: true as const };
    });
  } catch (error) {
    return { ok: false, why: reasonOf(error) };
  }
}

function timelineDaysOf(
  paths: CliPaths,
  env: Env,
  key: "archiveDays" | "deleteDays",
): (repo: null | string) => null | number {
  const known = new Map<null | string, null | number>();
  return (repo) => {
    const had = known.get(repo);
    if (had !== undefined) return had;
    let days: null | number;
    try {
      const checkout = repo === null || !existsSync(repo) ? null : locateCheckout(repo, { env });
      const config = checkout === null ? null : loadProjectConfig(checkout).config;
      days = resolveWorkflow(paths, config).crew[key].value;
    } catch {
      // A settings file that cannot be read: the archive stays until it can.
      days = null;
    }
    known.set(repo, days);
    return days;
  };
}
