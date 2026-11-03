/** Local leases and tickets with stale-process recovery and atomic acquisition. */
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join, posix, win32 } from "node:path";
import {
  holderIsGone,
  LockBusyError,
  type ProcessHolder,
  type StartTimeReader,
  withLock,
} from "../setup/lock";
import { HEAVY_SLOTS } from "./config";
import {
  parseHolder,
  type Store,
  type StoreHeld,
  type StoreLineEntry,
  type StoreTicket,
  type StoreUnits,
  slotOfWire,
  slotsUsed,
  wireOfSlot,
} from "./queue";
import { leaseHolder, startTimeReader } from "./windows";

/**
 * How often a holder touches its files, so a reader that cannot see its pid knows it lives.
 *
 * Why 5 s and 30 s: a container on this host that dies with SIGKILL holds its slot in
 * the other containers' view until its files go stale. At 30 s that wait stays short.
 * Stale after 6 missed touches leaves room for a writer slowed by a busy machine (its
 * timer runs late, never early). A touch changes one file's time, a few files per job:
 * no real disk load. And a writer that was judged gone too early writes its file again
 * at its next touch.
 */
export const HEARTBEAT_MS = 5_000;
/** A file nobody could judge by its pid is stale after this long without a touch. */
export const UNSEEN_STALE_MS = 30_000;
/** The folder's lock is held for milliseconds; a holder nobody can judge is stale after this. */
const LOCK_STALE_MS = 30_000;
/** How long a take waits for the folder's lock before it tries again next round. */
const LOCK_WAIT_MS = 2_000;
/** The folder's lock: readable by the lease judge, to judge who holds it. */
const LOCK_MODE = 0o664;
/** Lease and ticket files: every user reads them; only the writer changes them. */
const FILE_MODE = 0o644;
/** A temp file (`.<token>.tmp`) or a probe (`.probe-…`) older than this was left by a crash. */
const LEFTOVER_MS = 60_000;

/** Who wrote a file: a process, and the pid namespace its pid belongs to. */
export interface FileHolder extends ProcessHolder {
  /** `/proc/self/ns/pid` (Linux): two containers on one host may share a host name. */
  pidns: string | null;
}

/**
 * What one lease or ticket file holds. The record is the queue's text, untrusted. `gb` is the
 * wire's old name for what the job holds (`wireOfSlot`): an older `job run` counted gigabytes
 * there. This plugin reads any number above 0 as one slot, so a lease an older version wrote
 * counts as one, whatever it reserved.
 */
interface StoreFile {
  store: 1;
  gb: number;
  /** The `--exclusive` name a lease holds, in a store that keeps it. */
  exclusive?: string;
  holder: FileHolder;
  record: string;
}

/** A file as the store reads it: `StoreFile`, with the old number turned into a slot. */
interface ReadFile extends Omit<StoreFile, "gb"> {
  slot: boolean;
}

/** This process, as the writer of a file. Windows' start time comes from PowerShell. */
export function currentFileHolder(): FileHolder {
  return leaseHolder(process.platform);
}

function parseStoreFile(text: string): ReadFile | null {
  try {
    const value = JSON.parse(text) as Partial<StoreFile> | null;
    const holder = value?.holder;
    if (
      value?.store !== 1 ||
      typeof value.gb !== "number" ||
      !Number.isFinite(value.gb) ||
      typeof value.record !== "string" ||
      (value.exclusive !== undefined && typeof value.exclusive !== "string") ||
      typeof holder !== "object" ||
      holder === null ||
      typeof holder.pid !== "number" ||
      typeof holder.host !== "string"
    ) {
      return null;
    }
    return {
      store: 1,
      slot: slotOfWire(value.gb),
      ...(value.exclusive !== undefined && { exclusive: value.exclusive }),
      record: value.record,
      holder: {
        pid: holder.pid,
        host: holder.host,
        startTime: typeof holder.startTime === "string" ? holder.startTime : null,
        pidns: typeof holder.pidns === "string" ? holder.pidns : null,
      },
    };
  } catch {
    return null;
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

/**
 * The temp file a whole write goes through first: beside `file`, named `.<token>.tmp`.
 *
 * The folder comes from the platform's own `dirname`, never from the file's text: on Windows
 * a path separates with `\`, so "everything before the last `/`" is the whole path. A temp
 * file named after the lease's text then has no folder, the write fails with ENOENT, and the
 * queue runs the job unqueued (`docs/windows-jobs.md`: the queue applies in full there).
 *
 * `on` is the platform whose rules read the path. The default is this one, which is what a
 * real run has; a test states the other one, because `node:path`'s own default follows the
 * platform the process runs on.
 */
export function tempFileBeside(
  file: string,
  token: string,
  on: NodeJS.Platform = process.platform,
): string {
  const paths = on === "win32" ? win32 : posix;
  return paths.join(paths.dirname(file), `.${token}.tmp`);
}

/**
 * Writes `text` to `file` whole: a temp file beside it, then a rename. The temp file gets
 * FILE_MODE before the rename (chmod: the umask may have narrowed it), so readers can inspect it.
 */
function writeWhole(file: string, text: string, token: string): void {
  const temp = tempFileBeside(file, token);
  writeFileSync(temp, text, { mode: FILE_MODE });
  try {
    chmodSync(temp, FILE_MODE);
    renameSync(temp, file);
  } catch (error) {
    removeQuietly(temp);
    throw error;
  }
}

function removeQuietly(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    // Gone already (another reader removed it), or not ours to remove: it still counts for
    // nothing, because every reader judges it stale the same way.
  }
}

export interface LeaseStoreOptions {
  dir: string;
  label: string;
  /** A remark about one file (one this user may not read). Each file is named once. */
  onNote?: (line: string) => void;
  /** The writer of this process's files. Default: this process (`currentFileHolder`). */
  self?: FileHolder;
  /**
   * Is a file's holder gone? Default: `holderIsGone`, by pid where this machine sees it.
   * `startTimeOf` reads a pid's start time, cached for one look.
   */
  isGone?: (holder: FileHolder | null, lastSeenMs: number, startTimeOf: StartTimeReader) => boolean;
  /** Reads a pid's start time. Default: this platform's reader (`/proc`, `ps`, PowerShell). */
  startTimeOf?: StartTimeReader;
  heartbeatMs?: number;
}

/** A lease store, with what `job status` also shows. */
export interface LeaseStore extends Store {
  readonly dir: string;
  /** The jobs waiting in the line: what each needs, and its record. */
  waiting(): Promise<readonly StoreHeld[]>;
}

/**
 * A store over a local folder of lease and ticket files. It makes its subfolders.
 */
export function leaseStore(options: LeaseStoreOptions): LeaseStore {
  const me = options.self ?? currentFileHolder();
  const isGone =
    options.isGone ??
    ((holder: FileHolder | null, lastSeenMs: number, startTimeOf: StartTimeReader) => {
      // Our pid table holds only the pids of our own host and pid namespace.
      const visible = holder !== null && holder.host === me.host && holder.pidns === me.pidns;
      return holderIsGone(visible ? holder : null, lastSeenMs, UNSEEN_STALE_MS, startTimeOf);
    });
  const readStartTime = options.startTimeOf ?? startTimeReader(process.platform);
  const leases = join(options.dir, "leases");
  const tickets = join(options.dir, "tickets");
  /** The files this process wrote and still holds: the heartbeat touches them. */
  const mine = new Map<string, string>();
  /** Files already named in a note, so a wait of an hour says it once. */
  const noted = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const beat = () => {
    const now = new Date();
    for (const [file, text] of mine) {
      try {
        utimesSync(file, now, now);
      } catch (error) {
        // Removed by a reader that judged it stale (a long pause, a clock jump): write it
        // again, so the slot this job holds counts again.
        if (errorCode(error) === "ENOENT") {
          try {
            writeWhole(file, text, crypto.randomUUID());
          } catch {
            // The folder went away: nothing to hold on to.
          }
        }
      }
    }
  };

  const hold = (file: string, text: string) => {
    mine.set(file, text);
    if (timer === null) {
      timer = setInterval(beat, options.heartbeatMs ?? HEARTBEAT_MS);
      timer.unref();
    }
  };

  const letGo = (file: string) => {
    if (!mine.delete(file)) return;
    removeQuietly(file);
    if (mine.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const noteOnce = (path: string, line: string) => {
    if (noted.has(path)) return;
    noted.add(path);
    options.onNote?.(line);
  };

  /** A temp file or probe a crashed writer left: removed once it is older than a minute. */
  const removeLeftover = (path: string) => {
    try {
      if (Date.now() - statSync(path).mtimeMs > LEFTOVER_MS) removeQuietly(path);
    } catch {
      // Gone already, or not ours to read: the next look tries again.
    }
  };

  /** The live files in `folder`, each with its token. Stale ones are removed on the way. */
  const readLive = (folder: string): { token: string; file: ReadFile }[] => {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      throw error;
    }
    // One look reads each pid's start time once (on macOS each read starts `ps`).
    const startTimes = new Map<string, string | null>();
    const startTimeOf: StartTimeReader = (pid, like) => {
      const key = `${pid}\0${like?.split(":")[0] ?? ""}`;
      if (!startTimes.has(key)) startTimes.set(key, readStartTime(pid, like));
      return startTimes.get(key) ?? null;
    };
    const live: { token: string; file: ReadFile }[] = [];
    for (const name of names) {
      const path = join(folder, name);
      if (name.startsWith(".")) {
        if (name.endsWith(".tmp") || name.startsWith(".probe-")) removeLeftover(path);
        continue;
      }
      if (!name.endsWith(".json")) continue;
      let text: string | null;
      let mtimeMs: number;
      try {
        mtimeMs = statSync(path).mtimeMs;
      } catch (error) {
        if (errorCode(error) === "ENOENT") continue; // released just now
        throw error;
      }
      let unreadable: string | null = null;
      try {
        text = readFileSync(path, "utf8");
      } catch (error) {
        const code = errorCode(error);
        if (code === "ENOENT") continue; // released just now
        if (code !== "EACCES" && code !== "EPERM") throw error;
        // Another user wrote it with a narrow mode (an older plugin): its slot cannot be
        // counted. Judged like a file in a shape we cannot read: by its touches.
        unreadable = code;
        text = null;
      }
      const file = text === null ? null : parseStoreFile(text);
      if (mine.has(path)) {
        if (file !== null) live.push({ token: name.slice(0, -5), file });
        continue;
      }
      if (isGone(file?.holder ?? null, mtimeMs, startTimeOf)) {
        removeQuietly(path);
        continue;
      }
      if (unreadable !== null) {
        noteOnce(
          path,
          `${path} cannot be read (${unreadable}): it does not count as a slot until its writer stops touching it.`,
        );
      }
      // A file in a shape this plugin cannot read (a newer one wrote it) holds no slot we
      // can count; it goes once nobody touches it.
      if (file !== null) live.push({ token: name.slice(0, -5), file });
    }
    return live;
  };

  const write = (
    folder: string,
    slot: boolean,
    record: string,
    exclusive?: string,
  ): { path: string; token: string } => {
    const token = crypto.randomUUID();
    const path = join(folder, `${token}.json`);
    const text = JSON.stringify({
      store: 1,
      gb: wireOfSlot(slot),
      ...(exclusive !== undefined && { exclusive }),
      holder: me,
      record,
    } satisfies StoreFile);
    mkdirSync(folder, { recursive: true });
    writeWhole(path, text, token);
    hold(path, text);
    return { path, token };
  };

  return {
    dir: options.dir,
    label: options.label,

    held: () =>
      Promise.resolve().then(() =>
        readLive(leases).map(({ file }): StoreHeld => ({ slot: file.slot, text: file.record })),
      ),

    waiting: () =>
      Promise.resolve().then(() =>
        readLive(tickets).map(({ file }): StoreHeld => ({ slot: file.slot, text: file.record })),
      ),

    enqueue: (recordText) =>
      Promise.resolve().then((): StoreTicket => {
        const slot = parseHolder(recordText)?.slot ?? false;
        const { path, token } = write(tickets, slot, recordText);
        return {
          line: () =>
            Promise.resolve().then(() =>
              readLive(tickets).map(
                (entry): StoreLineEntry => ({
                  mine: entry.token === token,
                  tie: entry.token,
                  text: entry.file.record,
                }),
              ),
            ),
          release: () => letGo(path),
        };
      }),

    tryTake: async (slot: boolean, recordText, exclusive) => {
      try {
        return await withLock(
          options.dir,
          (): StoreUnits | null => {
            const held = readLive(leases);
            if (exclusive !== undefined && held.some(({ file }) => file.exclusive === exclusive)) {
              return null;
            }
            if (slot && slotsUsed(held.map(({ file }) => ({ slot: file.slot }))) >= HEAVY_SLOTS)
              return null;
            const { path } = write(leases, slot, recordText, exclusive);
            return { release: () => letGo(path) };
          },
          { waitMs: LOCK_WAIT_MS, fallbackStaleMs: LOCK_STALE_MS, mode: LOCK_MODE },
        );
      } catch (error) {
        if (error instanceof LockBusyError) return null; // another job is taking: next round
        throw error;
      }
    },
  };
}
