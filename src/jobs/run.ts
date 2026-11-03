/**
 * One heavy job, start to end: take a slot, start, wait, report, give back. The command is
 * started exactly once on every path. The pieces it calls are passed in (`JobDeps`), so
 * the tests run it with a fake queue and a fake launcher.
 */

import type { JobEnd } from "./launch";
import { durationText, ENDED_LINE_LEAD, type QueuedJob, type Reservation } from "./queue";

export interface JobRequest {
  /** The kind, or "" for a job with a name only (`--exclusive` without `--kind`). */
  kind: string;
  command: [string, ...string[]];
  /** `--exclusive <name>`: at most one job with this name at a time. */
  exclusive?: string | undefined;
  /**
   * Does the job take a slot? False for a job with a name only, and for a print-only run
   * (`tsc --version`): neither waits for a slot.
   */
  slot: boolean;
  /** This process's pid, recorded in the lease. */
  pid: number;
  checkout: string;
}

export interface JobDeps {
  /** Does an ancestor process hold a lease here (any lease)? */
  isNested: () => Promise<boolean>;
  /** Does an ancestor process hold a lease with this `--exclusive` name? */
  ancestorHoldsName: (name: string) => Promise<boolean>;
  acquire: (job: QueuedJob, onWaiting: (line: string) => void) => Promise<Reservation>;
  /** How this machine's clock reads: the two lines that say how long something took. */
  now: () => number;
  /** Starts the command and waits for it. */
  run: (argv: readonly [string, ...string[]]) => Promise<JobEnd>;
  say: (line: string) => void;
  /** True once a signal asked `job run` to stop: nothing new starts after it. */
  stopped?: () => boolean;
}

/** A short description of the command, for other jobs' waiting lines. */
export function describeCommand(command: readonly string[]): string {
  const what = command.join(" ");
  return what.length > 80 ? `${what.slice(0, 77)}...` : what;
}

/** The line `job run` says when a job that waited gets its place. */
function startedLine(what: string, waitedMs: number): string {
  return `Heavy job starts after ${durationText(waitedMs)}: ${what}`;
}

/** The line `job run` says after a job that waited ended, however it ended. */
function endedLine(what: string, end: JobEnd, ranMs: number): string {
  // The signal, when one ended it, with the wrapper named as the sender when the signal it
  // sent on is that same one: the person's Ctrl+C at `job run`, or a `kill` at it. A stop
  // that came from elsewhere (the kernel's OOM killer, another process's `kill`) belongs to
  // nobody here. Both notes are facts of their own, and one job can carry both.
  const how = end.signal === null ? `exit ${String(end.code)}` : `stopped by ${end.signal}`;
  const sent = end.sentOn ? " (sent on by job run)" : "";
  const leftovers = end.leftovers ? " (its leftover processes were stopped)" : "";
  return `${ENDED_LINE_LEAD}: ${what}, ${how}${sent} after ${durationText(ranMs)}${leftovers}`;
}

/** What the two lines about a job's run need: which job, and how it runs. */
interface Running {
  /** The argv `job run` starts. */
  argv: readonly [string, ...string[]];
  /** When the job's first waiting line was printed, or null when it never waited. */
  waitedSince: number | null;
  /** What the lines call the job (`describeCommand`). */
  what: string;
}

/** A job ran: how it ended, and how long it ran. */
interface Ran {
  end: JobEnd;
  ranMs: number;
}

/**
 * Starts the command for a job that waited, saying when it starts. It returns how the job
 * ended for the end line, which the caller says last: it comes after anything else the run
 * left to report. A job that never waited says neither line:
 * no noise on a free machine.
 */
async function runTimed(running: Running, deps: JobDeps): Promise<Ran> {
  const { waitedSince } = running;
  if (waitedSince !== null) {
    deps.say(startedLine(running.what, deps.now() - waitedSince));
  }
  const beganAt = deps.now();
  const end = await deps.run(running.argv);
  return { end, ranMs: deps.now() - beganAt };
}

/**
 * The end line, for a job that waited: how it ended, and how long it ran. A piped run's
 * status is the pipe's own, so this is the line that carries the job's own (the first
 * waiting line says so once: `pipeHint` in `queue.ts`).
 */
function sayEnded(running: Running, ran: Ran, deps: JobDeps): void {
  if (running.waitedSince === null) return;
  deps.say(endedLine(running.what, ran.end, ran.ranMs));
}

/**
 * A job inside another heavy job runs directly, using its parent's slot. Only an
 * `--exclusive` name its ancestors do not hold yet is taken first, with no slot and no place
 * in the line (QueuedJob.nested).
 */
async function runNested(request: JobRequest, deps: JobDeps): Promise<number> {
  const { exclusive } = request;
  const what = describeCommand(request.command);
  if (exclusive === undefined || (await deps.ancestorHoldsName(exclusive))) {
    return (await deps.run(request.command)).code;
  }
  const reservation = await deps.acquire(
    {
      checkout: request.checkout,
      exclusive,
      kind: request.kind,
      nested: true,
      pid: request.pid,
      slot: false,
      what,
    },
    deps.say,
  );
  try {
    if (deps.stopped?.() === true) return 1;
    const running: Running = {
      argv: request.command,
      waitedSince: reservation.waitedSince,
      what,
    };
    const ran = await runTimed(running, deps);
    sayEnded(running, ran, deps);
    return ran.end.code;
  } finally {
    reservation.release();
  }
}

/** Run once, releasing the lease however the child ends. */
export async function runJob(request: JobRequest, deps: JobDeps): Promise<number> {
  if (deps.stopped?.()) return 1;
  if (!request.slot && request.exclusive === undefined)
    return (await deps.run(request.command)).code;
  if (await deps.isNested()) return runNested(request, deps);
  const reservation = await deps.acquire(
    {
      checkout: request.checkout,
      exclusive: request.exclusive,
      kind: request.kind,
      pid: request.pid,
      slot: request.slot,
      what: describeCommand(request.command),
    },
    deps.say,
  );
  try {
    if (deps.stopped?.()) return 1;
    const running: Running = {
      argv: request.command,
      waitedSince: reservation.waitedSince,
      what: describeCommand(request.command),
    };
    const ran = await runTimed(running, deps);
    sayEnded(running, ran, deps);
    return ran.end.code;
  } finally {
    reservation.release();
  }
}
