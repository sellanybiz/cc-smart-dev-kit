/**
 * One heavy job, start to end: reserve, start, wait, report, give back. The command is
 * started exactly once on every path. The pieces it calls are passed in (`JobDeps`), so
 * the tests run it with a fake queue and a fake launcher.
 */

import { invocationOf, nestedCommand } from "../shell/command";
import { type KindSpec, withWorkers } from "./kinds";
import {
  chooseLaunch,
  killedForMemoryLine,
  type Launch,
  type LaunchFacts,
  launchArgv,
  oomKiller,
  type SliceControl,
  type SliceWeights,
  unitName,
} from "./launch";
import { sliceChain } from "./memory";
import type { QueuedJob, Reservation } from "./queue";

export interface JobRequest {
  /** The kind, or "" for a job with a name only (`--exclusive` without `--kind`). */
  kind: string;
  /** The kind's spec, or null without a kind. */
  spec: KindSpec | null;
  command: [string, ...string[]];
  /** `--exclusive <name>`: at most one job with this name at a time. */
  exclusive?: string | undefined;
  /** The GB to reserve: `--gb`, or the kind's size for this command. */
  gb: number;
  /** This process's pid: the lease records it, and the unit name carries it. */
  pid: number;
  checkout: string;
  /** The systemd slice for a scope launch. */
  slice: string;
  /** The CPU weight for the slice chain; 0 leaves systemd's default in force. */
  cpuWeight: number;
  /** The I/O weight for the slice chain; 0 leaves systemd's default in force. */
  ioWeight: number;
  /** When `job run` started (ms): makes the unit name unique. */
  startedAt: number;
}

export interface JobDeps {
  /** Does an ancestor process hold a lease here (any lease)? */
  isNested: () => Promise<boolean>;
  /** Does an ancestor process hold a lease with this `--exclusive` name? */
  ancestorHoldsName: (name: string) => Promise<boolean>;
  acquire: (job: QueuedJob, onWaiting: (line: string) => void) => Promise<Reservation>;
  /** Test workers for this many GB (`workerCount` with this machine's cores). */
  workersFor: (gb: number, gbEach: number) => number;
  /** The slice's `MemoryMax` for a job of this size (`sliceMemoryMax`). */
  memoryMaxFor: (gb: number) => string;
  /** How this machine can start a job; null when the config says `launch: plain`. */
  launchFacts: () => LaunchFacts | null;
  slice: SliceControl;
  /** Starts `argv` and waits for it; `scopeUnit` names its systemd scope, if it has one. */
  run: (argv: readonly [string, ...string[]], scopeUnit: string | null) => Promise<number>;
  say: (line: string) => void;
  /** True once a signal asked `job run` to stop: nothing new starts after it. */
  stopped?: () => boolean;
}

/** A short description of the command, for other jobs' waiting lines. */
export function describeCommand(command: readonly string[]): string {
  const what = command.join(" ");
  return what.length > 80 ? `${what.slice(0, 77)}...` : what;
}

/** A shell line (`sh -c "…"`) takes no extra option at its end: it would land in `$0`. */
function takesOptions(command: readonly [string, ...string[]]): boolean {
  const invocation = invocationOf([...command]);
  return (
    invocation === undefined || nestedCommand(invocation.program, invocation.args) === undefined
  );
}

/**
 * A job inside another heavy job: its memory is the parent's, so it runs directly. Only an
 * `--exclusive` name its ancestors do not hold yet is taken first, with 0 GB and no place
 * in the line (QueuedJob.nested).
 */
async function runNested(request: JobRequest, deps: JobDeps): Promise<number> {
  const { exclusive } = request;
  if (exclusive === undefined || (await deps.ancestorHoldsName(exclusive))) {
    return deps.run(request.command, null);
  }
  const reservation = await deps.acquire(
    {
      checkout: request.checkout,
      exclusive,
      gb: 0,
      kind: request.kind,
      nested: true,
      pid: request.pid,
      what: describeCommand(request.command),
    },
    deps.say,
  );
  try {
    if (deps.stopped?.() === true) return 1;
    return await deps.run(request.command, null);
  } finally {
    reservation.release();
  }
}

/**
 * Puts the CPU and I/O weights on every slice of the job's chain, before the job starts,
 * the same way and at the same moment as the ceiling. A weight whose controller this
 * machine's user manager was not given is skipped: systemd would record the property and
 * write nothing to the cgroup, so the job would carry no priority at all.
 *
 * The whole chain carries the weight because systemd shares CPU and disk I/O between
 * slices that are siblings. The heavy slice alone competes only with what sits beside it
 * inside the kit's own slice; the outermost slice of the chain is the one that competes
 * with the desktop and the sessions, and an intermediate one would compete if a unit ever
 * sat beside it.
 */
function setSliceWeights(request: JobRequest, deps: JobDeps): void {
  if (request.cpuWeight <= 0 && request.ioWeight <= 0) return;
  const controllers = deps.slice.controllers();
  const weights: SliceWeights = {
    ...(request.cpuWeight > 0 && controllers?.includes("cpu") === true
      ? { cpu: request.cpuWeight }
      : {}),
    ...(request.ioWeight > 0 && controllers?.includes("io") === true
      ? { io: request.ioWeight }
      : {}),
  };
  if (weights.cpu === undefined && weights.io === undefined) return;
  const named =
    weights.cpu !== undefined && weights.io !== undefined
      ? "CPU and I/O weights"
      : weights.cpu !== undefined
        ? "CPU weight"
        : "I/O weight";
  for (const slice of sliceChain(request.slice)) {
    if (!deps.slice.setWeights(slice, weights)) {
      deps.say(`could not set the ${named} on ${slice}: the job runs without priority there`);
    }
  }
}

/** Runs the job and returns its exit code. The reservation is given back however it ends. */
export async function runJob(request: JobRequest, deps: JobDeps): Promise<number> {
  const { command, gb, kind, pid, spec } = request;
  if (await deps.isNested()) return runNested(request, deps);

  const reservation = await deps.acquire(
    {
      checkout: request.checkout,
      exclusive: request.exclusive,
      gb,
      kind,
      pid,
      what: describeCommand(command),
    },
    deps.say,
  );
  try {
    if (deps.stopped?.() === true) return 1;
    const workers = spec?.workers;
    const sized =
      spec !== null && workers !== undefined && gb > 0 && takesOptions(command)
        ? withWorkers(spec, command, deps.workersFor(gb, workers.gbEach))
        : command;
    // A print-only run (`tsc --version`) reserves nothing: no memory group, and the
    // slice's ceiling must not move under the jobs that run.
    const facts = gb === 0 ? null : deps.launchFacts();
    const launch: Launch = facts === null ? { mode: "plain" } : chooseLaunch(facts);
    if ("note" in launch && launch.note !== undefined) deps.say(launch.note);

    let eventsPath: string | null = null;
    let scopeUnit: string | null = null;
    if (launch.mode === "scope") {
      const memoryMax = deps.memoryMaxFor(gb);
      if (!deps.slice.setMemoryMax(request.slice, memoryMax)) {
        deps.say(
          `could not set ${request.slice} MemoryMax=${memoryMax}: the job runs without the slice's ceiling`,
        );
      }
      setSliceWeights(request, deps);
      const group = deps.slice.controlGroup(request.slice);
      eventsPath = group === null ? null : `/sys/fs/cgroup${group}/memory.events`;
      scopeUnit = unitName(request.slice, kind, pid, request.startedAt);
    }
    const before = eventsPath === null ? null : deps.slice.readFile(eventsPath);

    const code = await deps.run(
      launchArgv(launch, sized, { kind, pid, slice: request.slice, startedAt: request.startedAt }),
      scopeUnit,
    );

    const after = eventsPath === null ? null : deps.slice.readFile(eventsPath);
    // The count is the whole slice's: another job's kill raises it too, so a job that
    // ended well (exit 0) was not the one killed.
    const killer = code === 0 ? null : oomKiller(before, after);
    if (killer !== null) deps.say(killedForMemoryLine(killer, request.slice, code));
    return code;
  } finally {
    reservation.release();
  }
}
