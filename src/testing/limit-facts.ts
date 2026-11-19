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
  /** `systemd-run` and `choom` found on the PATH (the default: both). */
  programs?: string[];
  /** Any other program (a job's command) that is not on the PATH. */
  missing?: string[];
  oomd?: boolean;
  /** How each systemd call ends; the default answers "ok" to everything. */
  systemd?: (argv: readonly string[]) => SystemdResult;
  /** What a systemd call that prints answers; the default is a scope that ended well. */
  systemdText?: (argv: readonly string[]) => string | null;
}

export interface FakeLimits {
  facts: LimitFacts;
  /** Every systemd call, in order, the ones that print included. */
  calls: string[][];
  files: Map<string, string>;
  /** Every wait, in ms: a read that waits for systemd to settle shows here. */
  pauses: number[];
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
  const infra = new Set(options.programs ?? ["systemd-run", "choom"]);
  const missing = new Set(options.missing ?? []);
  const calls: string[][] = [];
  const pauses: number[] = [];
  const facts: LimitFacts = {
    platform: options.platform ?? "linux",
    uid,
    read: (path) => files.get(path) ?? null,
    cpuCount: () => options.cpus ?? 12,
    hasProgram: (name) =>
      name === "systemd-run" || name === "choom" ? infra.has(name) : !missing.has(name),
    oomdRunning: () => options.oomd ?? true,
    systemd: (argv) => {
      calls.push([...argv]);
      return options.systemd?.(argv) ?? "ok";
    },
    systemdText: (argv) => {
      calls.push([...argv]);
      return options.systemdText === undefined
        ? "ActiveState=inactive\nResult=success\n"
        : options.systemdText(argv);
    },
    pause: (ms) => {
      pauses.push(ms);
    },
  };
  return { facts, calls, files, pauses };
}
