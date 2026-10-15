/**
 * Where reservations live: a folder of small files, one per lease (memory held) and one
 * per ticket (a place in the line).
 *
 *   <dir>/leases/<token>.json    a job holds this many GB
 *   <dir>/tickets/<token>.json   a job waits for its turn
 *   <dir>/lock                   held for a moment while a job takes memory
 *
 * Each file names the process that wrote it: its pid, that process's start time, the host
 * name and the pid namespace. A file is stale when that process is gone: the pid is dead,
 * or alive with another start time (the pid was reused). The judge is the plugin's one
 * lock judge, `holderIsGone` in `src/setup/lock.ts`. A stale file counts for nothing, and
 * the next reader removes it. So a job killed with SIGKILL frees its memory at the next
 * look, with no clean-up step.
 *
 * A file from a process this machine cannot see (another host, another pid namespace: a
 * container sharing the folder) cannot be judged by its pid. Its writer touches it every
 * 30 seconds (the heartbeat), and it is stale when it was not touched for 2 minutes.
 *
 * Taking memory happens under the folder's lock (`withLock`, the same lock as setup's),
 * so two jobs never both take the last free GB. Every file is written whole: a temp file,
 * then a rename, so a reader never sees half a record.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  currentHolder,
  holderIsGone,
  LockBusyError,
  type ProcessHolder,
  withLock,
} from "../setup/lock";
import type {
  LiveReading,
  Store,
  StoreHeld,
  StoreLineEntry,
  StoreTicket,
  StoreUnits,
} from "./queue";

/** How often a holder touches its files, so a reader that cannot see its pid knows it lives. */
export const HEARTBEAT_MS = 30_000;
/** A file nobody could judge by its pid is stale after this long without a touch. */
export const UNSEEN_STALE_MS = 2 * 60_000;
/** The folder's lock is held for milliseconds; a holder nobody can judge is stale after this. */
const LOCK_STALE_MS = 30_000;
/** How long a take waits for the folder's lock before it tries again next round. */
const LOCK_WAIT_MS = 2_000;

/** Who wrote a file: a process, and the pid namespace its pid belongs to. */
export interface FileHolder extends ProcessHolder {
  /** `/proc/self/ns/pid` (Linux): two containers on one host may share a host name. */
  pidns: string | null;
}

/** What one lease or ticket file holds. The record is the queue's text, untrusted. */
interface StoreFile {
  store: 1;
  gb: number;
  holder: FileHolder;
  record: string;
}

function pidNamespace(): string | null {
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return null; // not Linux
  }
}

let self: FileHolder | undefined;

/** This process, as the writer of a file. */
export function currentFileHolder(): FileHolder {
  self ??= { ...currentHolder(), pidns: pidNamespace() };
  return self;
}

function parseStoreFile(text: string): StoreFile | null {
  try {
    const value = JSON.parse(text) as Partial<StoreFile> | null;
    const holder = value?.holder;
    if (
      value?.store !== 1 ||
      typeof value.gb !== "number" ||
      !Number.isFinite(value.gb) ||
      typeof value.record !== "string" ||
      typeof holder !== "object" ||
      holder === null ||
      typeof holder.pid !== "number" ||
      typeof holder.host !== "string"
    ) {
      return null;
    }
    return {
      store: 1,
      gb: value.gb,
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

/** Writes `text` to `file` whole: a temp file beside it, then a rename. */
function writeWhole(file: string, text: string, token: string): void {
  const dir = file.slice(0, file.lastIndexOf("/"));
  const temp = join(dir, `.${token}.tmp`);
  writeFileSync(temp, text, { mode: 0o644 });
  renameSync(temp, file);
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
  /** How waiting lines name it: "this machine", or the shared folder. */
  label: string;
  shared: boolean;
  /** The GB this store gives out, read again for every decision. May throw. */
  capacityGb: () => number;
  live?: (() => LiveReading | null) | undefined;
  /** The writer of this process's files. Default: this process (`currentFileHolder`). */
  self?: FileHolder;
  /** Is a file's holder gone? Default: `holderIsGone`, by pid where this machine sees it. */
  isGone?: (holder: FileHolder | null, lastSeenMs: number) => boolean;
  heartbeatMs?: number;
}

/** A lease store, with what `job status` also shows. */
export interface LeaseStore extends Store {
  readonly dir: string;
  /** The jobs waiting in the line: what each needs, and its record. */
  waiting(): Promise<readonly StoreHeld[]>;
}

/** A store over a folder of lease and ticket files. The folder must exist. */
export function leaseStore(options: LeaseStoreOptions): LeaseStore {
  const me = options.self ?? currentFileHolder();
  const isGone =
    options.isGone ??
    ((holder: FileHolder | null, lastSeenMs: number) => {
      // Our pid table holds only the pids of our own host and pid namespace.
      const visible = holder !== null && holder.host === me.host && holder.pidns === me.pidns;
      return holderIsGone(visible ? holder : null, lastSeenMs, UNSEEN_STALE_MS);
    });
  const leases = join(options.dir, "leases");
  const tickets = join(options.dir, "tickets");
  /** The files this process wrote and still holds: the heartbeat touches them. */
  const mine = new Map<string, string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const beat = () => {
    const now = new Date();
    for (const [file, text] of mine) {
      try {
        utimesSync(file, now, now);
      } catch (error) {
        // Removed by a reader that judged it stale (a long pause, a clock jump): write it
        // again, so the memory this job holds counts again.
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

  /** The live files in `folder`, each with its token. Stale ones are removed on the way. */
  const readLive = (folder: string): { token: string; file: StoreFile }[] => {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      throw error;
    }
    const live: { token: string; file: StoreFile }[] = [];
    for (const name of names) {
      if (!name.endsWith(".json") || name.startsWith(".")) continue;
      const path = join(folder, name);
      let text: string;
      let mtimeMs: number;
      try {
        mtimeMs = statSync(path).mtimeMs;
        text = readFileSync(path, "utf8");
      } catch (error) {
        if (errorCode(error) === "ENOENT") continue; // released just now
        throw error;
      }
      const file = parseStoreFile(text);
      if (mine.has(path)) {
        if (file !== null) live.push({ token: name.slice(0, -5), file });
        continue;
      }
      if (isGone(file?.holder ?? null, mtimeMs)) {
        removeQuietly(path);
        continue;
      }
      // A file in a shape this plugin cannot read (a newer one wrote it) holds no GB we
      // can count; it goes once nobody touches it.
      if (file !== null) live.push({ token: name.slice(0, -5), file });
    }
    return live;
  };

  const write = (folder: string, gb: number, record: string): { path: string; token: string } => {
    const token = crypto.randomUUID();
    const path = join(folder, `${token}.json`);
    const text = JSON.stringify({ store: 1, gb, holder: me, record } satisfies StoreFile);
    mkdirSync(folder, { recursive: true });
    writeWhole(path, text, token);
    hold(path, text);
    return { path, token };
  };

  return {
    dir: options.dir,
    label: options.label,
    shared: options.shared,
    live: options.live,
    capacityGb: () => Promise.resolve().then(options.capacityGb),

    held: () =>
      Promise.resolve().then(() =>
        readLive(leases).map(({ file }): StoreHeld => ({ gb: file.gb, text: file.record })),
      ),

    waiting: () =>
      Promise.resolve().then(() =>
        readLive(tickets).map(({ file }): StoreHeld => ({ gb: file.gb, text: file.record })),
      ),

    enqueue: (recordText) =>
      Promise.resolve().then((): StoreTicket => {
        const gb = (JSON.parse(recordText) as { gb?: unknown }).gb;
        const { path, token } = write(tickets, typeof gb === "number" ? gb : 0, recordText);
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

    tryTake: async (gb, recordText) => {
      try {
        return await withLock(
          options.dir,
          (): StoreUnits | null => {
            const heldGb = readLive(leases).reduce((sum, { file }) => sum + file.gb, 0);
            if (heldGb + gb > options.capacityGb()) return null;
            const { path } = write(leases, gb, recordText);
            return { gb, release: () => letGo(path) };
          },
          { waitMs: LOCK_WAIT_MS, fallbackStaleMs: LOCK_STALE_MS },
        );
      } catch (error) {
        if (error instanceof LockBusyError) return null; // another job is taking: next round
        throw error;
      }
    },
  };
}

/** A whole number of GB in a `budget` file, or a reason it is not one. */
export function readBudgetFile(dir: string): { gb: number } | { problem: string } {
  const file = join(dir, "budget");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return { problem: `${file} cannot be read (${errorCode(error) ?? String(error)})` };
  }
  const value = text.trim();
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    return { problem: `${file} does not hold a whole number of GB` };
  }
  return { gb: Number(value) };
}

/**
 * Opens a shared folder as a store, or says why it cannot be used: the folder is missing,
 * its `budget` file is missing or wrong, or a file cannot be written and removed there.
 * Never a wait that cannot end: a folder that does not work is left out, with a note.
 */
export function openSharedStore(dir: string): { store: LeaseStore } | { note: string } {
  if (!existsSync(dir)) {
    return { note: `The shared folder ${dir} is missing: this job runs without its budget.` };
  }
  const budget = readBudgetFile(dir);
  if ("problem" in budget) {
    return { note: `The shared folder ${dir} is left out: ${budget.problem}.` };
  }
  for (const folder of ["leases", "tickets"]) {
    const probe = join(dir, folder, `.probe-${crypto.randomUUID()}`);
    try {
      mkdirSync(join(dir, folder), { recursive: true });
      writeFileSync(probe, "");
      unlinkSync(probe);
    } catch (error) {
      return {
        note: `The shared folder ${dir} is left out: ${join(dir, folder)} cannot be written (${errorCode(error) ?? String(error)}).`,
      };
    }
  }
  const store = leaseStore({
    dir,
    label: dir,
    shared: true,
    capacityGb: () => {
      const now = readBudgetFile(dir);
      if ("problem" in now) throw new Error(now.problem);
      return now.gb;
    },
  });
  return { store };
}
