/**
 * Fake `LimitFacts` for tests: a Linux machine whose systemd user manager works, with its
 * files held in a map and every systemd call recorded and answered by a function. A test
 * never touches the host's systemd (`src/jobs/limits.ts`).
 */
import {
  JOBS_SLICE,
  type LimitFacts,
  type SystemdResult,
  userManagerCgroup,
  userSliceCgroup,
} from "../jobs/limits";

export interface FakeLimitOptions {
  platform?: NodeJS.Platform;
  uid?: number | null;
  /** Files by absolute path; merged over the defaults (the controllers file). */
  files?: Record<string, string | null>;
  cpus?: number;
  /** Programs found on the PATH. */
  programs?: string[];
  oomd?: boolean;
  /** How each systemd call ends; the default answers "ok" to everything. */
  systemd?: (argv: readonly string[]) => SystemdResult;
}

export interface FakeLimits {
  facts: LimitFacts;
  /** Every systemd call, in order. */
  calls: string[][];
  files: Map<string, string>;
}

export const FAKE_UID = 1000;

/** The cgroup folder of the jobs' slice in the fake world. */
export const fakeSliceDir = (uid = FAKE_UID) => `/sys/fs/cgroup${userSliceCgroup(uid, JOBS_SLICE)}`;

/** The controllers file of the fake user manager. */
export const fakeControllersFile = (uid = FAKE_UID) =>
  `/sys/fs/cgroup${userManagerCgroup(uid)}/cgroup.controllers`;

export function fakeLimitFacts(options: FakeLimitOptions = {}): FakeLimits {
  const uid = options.uid === undefined ? FAKE_UID : options.uid;
  const files = new Map<string, string>();
  files.set(fakeControllersFile(uid ?? FAKE_UID), "cpu memory pids\n");
  for (const [path, text] of Object.entries(options.files ?? {})) {
    if (text === null) files.delete(path);
    else files.set(path, text);
  }
  const programs = new Set(options.programs ?? ["systemd-run", "choom"]);
  const calls: string[][] = [];
  const facts: LimitFacts = {
    platform: options.platform ?? "linux",
    uid,
    read: (path) => files.get(path) ?? null,
    cpuCount: () => options.cpus ?? 12,
    hasProgram: (name) => programs.has(name),
    oomdRunning: () => options.oomd ?? true,
    systemd: (argv) => {
      calls.push([...argv]);
      return options.systemd?.(argv) ?? "ok";
    },
  };
  return { facts, calls, files };
}
