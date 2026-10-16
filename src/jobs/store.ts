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
 * look, with no clean-up step. Windows reads a process's start time with PowerShell
 * (`windows.ts`), and a holder it cannot judge counts as alive: a job waits, never runs
 * on top.
 *
 * A file from a process this machine cannot see (another pid namespace: a container on
 * this host sharing the folder) cannot be judged by its pid. Its writer touches it every
 * 5 seconds (the heartbeat), and it is stale when it was not touched for 30 seconds
 * (`HEARTBEAT_MS`, `UNSEEN_STALE_MS`: why those numbers).
 *
 * Taking memory happens under the folder's lock (`withLock`, the same lock as setup's,
 * here with mode 0664 so every user of a shared folder can read who holds it), so two jobs
 * never both take the last free GB. Every file is written whole: a temp file, then a
 * rename, so a reader never sees half a record. Lease and ticket files are 0644: every
 * user of a shared folder reads them; only their writer changes them.
 *
 * A SHARED FOLDER is for one host: containers or users on one machine, through a bind
 * mount. They share one clock, which the time-based judge needs. A folder on a network
 * file system (NFS, SMB, 9p, sshfs …) is left out with a note: there, clocks differ and
 * O_EXCL and rename may not hold.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statfsSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  holderIsGone,
  LockBusyError,
  type ProcessHolder,
  type StartTimeReader,
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
import { leaseHolder, startTimeReader } from "./windows";

/**
 * How often a holder touches its files, so a reader that cannot see its pid knows it lives.
 *
 * Why 5 s and 30 s: a container on this host that dies with SIGKILL holds its memory in
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
/** The folder's lock: every user of a shared folder reads it, to judge who holds it. */
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

/** What one lease or ticket file holds. The record is the queue's text, untrusted. */
interface StoreFile {
  store: 1;
  gb: number;
  /** The `--exclusive` name a lease holds, in a store that keeps it. */
  exclusive?: string;
  holder: FileHolder;
  record: string;
}

/** This process, as the writer of a file. Windows' start time comes from PowerShell. */
export function currentFileHolder(): FileHolder {
  return leaseHolder(process.platform);
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
      gb: value.gb,
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
 * Writes `text` to `file` whole: a temp file beside it, then a rename. The temp file gets
 * FILE_MODE before the rename (chmod: the umask may have narrowed it), so other users
 * of a shared folder can read it.
 */
function writeWhole(file: string, text: string, token: string): void {
  const dir = file.slice(0, file.lastIndexOf("/"));
  const temp = join(dir, `.${token}.tmp`);
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
  /** How waiting lines name it: "this machine", or the shared folder. */
  label: string;
  shared: boolean;
  /** The GB this store gives out, read again for every decision. May throw. */
  capacityGb: () => number;
  /** Does this store keep an `--exclusive` name to one job? Default: every name. May throw. */
  keepsExclusive?: (name: string) => boolean;
  live?: (() => LiveReading | null) | undefined;
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
 * A store over a folder of lease and ticket files. The folder must exist. This machine's
 * store makes its `leases/` and `tickets/`; a shared store never makes a folder (the
 * machine's own setup prepares it, `openSharedStore`).
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
  const readLive = (folder: string): { token: string; file: StoreFile }[] => {
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
    const live: { token: string; file: StoreFile }[] = [];
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
        // Another user wrote it with a narrow mode (an older plugin): its GB cannot be
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
          `${path} cannot be read (${unreadable}): its GB do not count until its writer stops touching it.`,
        );
      }
      // A file in a shape this plugin cannot read (a newer one wrote it) holds no GB we
      // can count; it goes once nobody touches it.
      if (file !== null) live.push({ token: name.slice(0, -5), file });
    }
    return live;
  };

  const write = (
    folder: string,
    gb: number,
    record: string,
    exclusive?: string,
  ): { path: string; token: string } => {
    const token = crypto.randomUUID();
    const path = join(folder, `${token}.json`);
    const text = JSON.stringify({
      store: 1,
      gb,
      ...(exclusive !== undefined && { exclusive }),
      holder: me,
      record,
    } satisfies StoreFile);
    if (!options.shared) mkdirSync(folder, { recursive: true });
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
    keepsExclusive: (name) => Promise.resolve().then(() => options.keepsExclusive?.(name) ?? true),

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

    tryTake: async (gb, recordText, exclusive) => {
      try {
        return await withLock(
          options.dir,
          (): StoreUnits | null => {
            const held = readLive(leases);
            if (exclusive !== undefined && held.some(({ file }) => file.exclusive === exclusive)) {
              return null;
            }
            const heldGb = held.reduce((sum, { file }) => sum + file.gb, 0);
            if (gb > 0 && heldGb + gb > options.capacityGb()) return null;
            const { path } = write(leases, gb, recordText, exclusive);
            return { gb, release: () => letGo(path) };
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
 * The names a shared folder keeps to one job (`job run --exclusive`): its `exclusive`
 * file, one name a line; blank lines and `#` comments are skipped. No file: no names.
 */
export function readExclusiveNames(dir: string): ReadonlySet<string> {
  let text: string;
  try {
    text = readFileSync(join(dir, "exclusive"), "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return new Set();
    throw error;
  }
  return new Set(
    text
      .split("\n")
      .map((line) => line.replace(/#.*/, "").trim())
      .filter((line) => line !== ""),
  );
}

/**
 * File systems whose clocks or locks a shared folder cannot trust: the `f_type` that
 * `statfs` gives on Linux (the kernel's magic numbers, `linux/magic.h`).
 */
const NETWORK_FS: ReadonlyMap<number, string> = new Map([
  [0x6969, "NFS"],
  [0x517b, "SMB"],
  [0xff534d42, "CIFS"],
  [0xfe534d42, "SMB2"],
  [0x01021997, "9p"],
  [0x5346414f, "AFS"],
  [0x6b414653, "AFS"],
  [0x00c36400, "Ceph"],
  [0x73757245, "Coda"],
  [0x564c, "NCP"],
  [0x0bd00bd0, "Lustre"],
  [0x01161970, "GFS2"],
  [0x7461636f, "OCFS2"],
]);
const FUSE_MAGIC = 0x65735546;
/** FUSE file systems that reach another machine (`fuse.<subtype>` in mountinfo). */
const NETWORK_FUSE = new Set([
  "sshfs",
  "rclone",
  "s3fs",
  "gcsfuse",
  "goofys",
  "glusterfs",
  "juicefs",
  "davfs",
  "curlftpfs",
  "cephfs",
]);

/** Undoes mountinfo's octal escapes (`\040` is a space). */
function unescapeMount(path: string): string {
  return path.replace(/\\([0-7]{3})/g, (_, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

/** The type (`fuse.sshfs`, `ext4` …) of the mount that holds `path`, from mountinfo text. */
export function mountTypeOf(path: string, mountinfo: string): string | null {
  let best: { point: string; type: string } | null = null;
  for (const line of mountinfo.split("\n")) {
    const [left, right] = line.split(" - ");
    const point = left?.split(" ")[4];
    const type = right?.split(" ")[0];
    if (point === undefined || type === undefined) continue;
    const mount = unescapeMount(point);
    const inside = mount === "/" || path === mount || path.startsWith(`${mount}/`);
    if (inside && (best === null || mount.length >= best.point.length)) {
      best = { point: mount, type };
    }
  }
  return best?.type ?? null;
}

/** What a shared folder needs from the system: replaced in the tests. */
export interface SharedFolderFacts {
  platform: NodeJS.Platform;
  /** `statfs(dir).type`, or null when it cannot be read. */
  fsType: (dir: string) => number | null;
  /** `/proc/self/mountinfo`, or null. */
  mountinfo: () => string | null;
}

export const realSharedFolderFacts: SharedFolderFacts = {
  platform: process.platform,
  fsType: (dir) => {
    try {
      return statfsSync(dir).type;
    } catch {
      return null;
    }
  },
  mountinfo: () => {
    try {
      return readFileSync("/proc/self/mountinfo", "utf8");
    } catch {
      return null;
    }
  },
};

/** The network file system `dir` is on (Linux), or null when it is a local one. */
export function networkFileSystem(dir: string, facts: SharedFolderFacts): string | null {
  if (facts.platform !== "linux") return null;
  const type = facts.fsType(dir);
  if (type === null) return null;
  const known = NETWORK_FS.get(type);
  if (known !== undefined) return known;
  if (type !== FUSE_MAGIC) return null;
  const info = facts.mountinfo();
  let real = dir;
  try {
    real = realpathSync(dir);
  } catch {
    // Keep the path as given.
  }
  const mount = info === null ? null : mountTypeOf(real, info);
  const subtype = mount?.startsWith("fuse.") ? mount.slice(5) : null;
  return subtype !== null && NETWORK_FUSE.has(subtype) ? `fuse.${subtype}` : null;
}

/**
 * Opens a shared folder as a store, or says why it cannot be used: the folder is missing,
 * it sits on a network file system, its `budget` file is missing or wrong, its `leases/`
 * or `tickets/` is missing, or a file cannot be written and removed there. It never makes
 * a folder there: the machine's own setup prepares it. Never a wait that cannot end: a
 * folder that does not work is left out, with a note.
 */
export function openSharedStore(
  dir: string,
  options: { facts?: SharedFolderFacts; onNote?: (line: string) => void } = {},
): { store: LeaseStore } | { note: string } {
  if (!existsSync(dir)) {
    return { note: `The shared folder ${dir} is missing: this job runs without its budget.` };
  }
  const network = networkFileSystem(dir, options.facts ?? realSharedFolderFacts);
  if (network !== null) {
    return {
      note: `The shared folder ${dir} is left out: it is on a network file system (${network}). A shared folder is for one host: containers or users on this machine, through a bind mount.`,
    };
  }
  const budget = readBudgetFile(dir);
  if ("problem" in budget) {
    return { note: `The shared folder ${dir} is left out: ${budget.problem}.` };
  }
  for (const folder of ["leases", "tickets"]) {
    const path = join(dir, folder);
    let isFolder = false;
    try {
      isFolder = statSync(path).isDirectory();
    } catch {
      // Missing, or not ours to see: said below.
    }
    if (!isFolder) {
      return { note: `The shared folder ${dir} is left out: ${path} is missing.` };
    }
    const probe = join(path, `.probe-${crypto.randomUUID()}`);
    try {
      writeFileSync(probe, "");
      unlinkSync(probe);
    } catch (error) {
      return {
        note: `The shared folder ${dir} is left out: ${path} cannot be written (${errorCode(error) ?? String(error)}).`,
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
    keepsExclusive: (name) => readExclusiveNames(dir).has(name),
    ...(options.onNote !== undefined && { onNote: options.onNote }),
  });
  return { store };
}
