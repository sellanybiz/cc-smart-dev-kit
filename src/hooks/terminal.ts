/**
 * The session's own terminal device: how a hook reaches the terminal the person is looking at
 * for an event whose answer Claude Code does not read.
 *
 * A hook has **no controlling terminal** (`/dev/tty` fails with ENXIO, proved live on
 * 2.1.301), and Claude Code writes a hook's `terminalSequence` field to the screen only for
 * the events whose answer it reads (`notify.ts` § `TERMINAL_SEQUENCE_EVENTS`). Claude Code's
 * own process, though, is attached to the session's terminal — the tmux pane's or the ssh
 * session's pty — on its standard descriptors. So: read `CLAUDE_PID` (the pid Claude Code
 * sets for its hooks; without it, the hook's parent, which is Claude Code), follow
 * `/proc/<pid>/fd/0` (then 1, 2), and write the sequence to the device it names — but only a
 * `/dev/pts/<n>` or a `/dev/tty<n>` **this user owns**: anything else would put the bytes in
 * another person's session or on a serial line.
 *
 * Linux only (`/proc`): nowhere else can a hook find the device. Proved live (2026-10-16): a
 * StopFailure alert written this way arrived in the terminal beyond tmux, once.
 */
import { closeSync, constants, openSync, readlinkSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { Env } from "./run";

/** The terminal devices a hook may write to: a pty or a virtual console, nothing else. */
const TERMINAL_DEVICE = /^\/dev\/(?:pts\/\d+|tty\d+)$/;

/** What the search reads; a test passes its own, so nothing touches a real `/proc`. */
export interface TerminalProbe {
  /** Where `/proc` is mounted (a test points this at its own tree). */
  procRoot: string;
  /** The Claude Code process whose descriptors are read. */
  pid: number;
  platform: NodeJS.Platform;
  /** The user this hook runs as: only their own device is ever written to. */
  uid: number;
  /** `readlink` of a path; null when it does not exist or cannot be read. */
  readlink: (path: string) => null | string;
  /** The uid owning a path; null when it cannot be read. */
  owner: (path: string) => null | number;
  /** True for a path this hook may write an alert to (`TERMINAL_DEVICE`); a test may widen it. */
  isTerminalDevice?: (device: string) => boolean;
}

/** True for the devices a hook may write to: a pty or a virtual console, nothing else. */
export function isTerminalDevice(device: string): boolean {
  return TERMINAL_DEVICE.test(device);
}

/**
 * The pid of the Claude Code this hook runs under: `CLAUDE_PID`, which Claude Code sets for
 * every hook (docs/claude-code-contract.md), else the hook's parent process. `fallback`
 * without a usable pid: 0, which matches no `/proc` entry.
 */
export function claudePid(env: Env, fallback: number): number {
  const pid = Number(env.CLAUDE_PID ?? "");
  if (Number.isInteger(pid) && pid > 1) return pid;
  return Number.isInteger(fallback) && fallback > 1 ? fallback : 0;
}

/**
 * The controlling terminal a hook tries first: `/dev/tty` on every system that has one.
 * Windows has no such device, and a path of that name there would be an ordinary file on the
 * current drive — a write would land in that file instead of a terminal — so nothing is
 * tried, and the caller falls back.
 */
export function ttyDevice(platform: NodeJS.Platform): null | string {
  return platform === "win32" ? null : "/dev/tty";
}

/** The session's terminal device (`/dev/pts/3`), or null when there is none to write to. */
export function sessionTerminalDevice(probe: TerminalProbe): null | string {
  if (probe.platform !== "linux") return null;
  const allowed = probe.isTerminalDevice ?? isTerminalDevice;
  for (const fd of [0, 1, 2]) {
    const device = probe.readlink(join(probe.procRoot, String(probe.pid), "fd", String(fd)));
    if (device === null || !allowed(device)) continue;
    // Never another user's device: a wrong write would land in their session.
    if (probe.owner(device) !== probe.uid) continue;
    return device;
  }
  return null;
}

/**
 * Writes `text` to a device file: opened for writing, written, closed. False when it cannot
 * be. Never `O_CREAT`: a device that is gone must not become a new file in `/dev`.
 */
export function writeDevice(device: string, text: string): boolean {
  try {
    const fd = openSync(device, constants.O_WRONLY);
    try {
      writeSync(fd, text);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    // The device is gone (the session ended), or not writable by this user: no alert, and
    // never a failure — a notifier must not stop a session.
    return false;
  }
}

/** The real probe: `/proc`, this process's user, and the hook's own environment. */
export function realTerminalProbe(env: Env, parentPid: number): TerminalProbe {
  return {
    pid: claudePid(env, parentPid),
    platform: process.platform,
    procRoot: "/proc",
    uid: typeof process.getuid === "function" ? process.getuid() : -1,
    readlink: (path) => {
      try {
        return readlinkSync(path);
      } catch {
        return null;
      }
    },
    owner: (path) => {
      try {
        return statSync(path).uid;
      } catch {
        return null;
      }
    },
  };
}
