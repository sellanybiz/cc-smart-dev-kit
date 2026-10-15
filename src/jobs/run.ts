/**
 * One heavy job, start to end: reserve, start, wait, report, give back. The command is
 * started exactly once on every path. The pieces it calls are passed in (`JobDeps`), so
 * the tests run it with a fake queue and a fake launcher.
 */

import { invocationOf, nestedCommand } from "../shell/command";
import { type KindSpec, withWorkers } from "./kinds";
import {
  chooseLaunch,
  type Launch,
  type LaunchFacts,
  launchArgv,
  oomKills,
  type SliceControl,
} from "./launch";
import type { QueuedJob, Reservation } from "./queue";

export interface JobRequest {
  kind: string;
  spec: KindSpec;
  command: [string, ...string[]];
  /** The GB to reserve: `--gb`, or the kind's size for this command. */
  gb: number;
  /** This process's pid: the lease records it, and the unit name carries it. */
  pid: number;
  checkout: string;
  /** The systemd slice for a scope launch. */
  slice: string;
  /** When `job run` started (ms): makes the unit name unique. */
  startedAt: number;
}

export interface JobDeps {
  isNested: () => Promise<boolean>;
  acquire: (job: QueuedJob, onWaiting: (line: string) => void) => Promise<Reservation>;
  /** Test workers for this many GB (`workerCount` with this machine's cores). */
  workersFor: (gb: number, gbEach: number) => number;
  /** The slice's `MemoryMax` for a job of this size (`sliceMemoryMax`). */
  memoryMaxFor: (gb: number) => string;
  /** How this machine can start a job; null when the config says `launch: plain`. */
  launchFacts: () => LaunchFacts | null;
  slice: SliceControl;
  run: (argv: readonly [string, ...string[]]) => Promise<number>;
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

/** Runs the job and returns its exit code. The reservation is given back however it ends. */
export async function runJob(request: JobRequest, deps: JobDeps): Promise<number> {
  const { command, gb, kind, pid, spec } = request;
  if (await deps.isNested()) return deps.run(command);

  const reservation = await deps.acquire(
    { checkout: request.checkout, gb, kind, pid, what: describeCommand(command) },
    deps.say,
  );
  try {
    if (deps.stopped?.() === true) return 1;
    const workers = spec.workers;
    const sized =
      workers !== undefined && gb > 0 && takesOptions(command)
        ? withWorkers(spec, command, deps.workersFor(gb, workers.gbEach))
        : command;
    // A print-only run (`tsc --version`) reserves nothing: no memory group, and the
    // slice's ceiling must not move under the jobs that run.
    const facts = gb === 0 ? null : deps.launchFacts();
    const launch: Launch = facts === null ? { mode: "plain" } : chooseLaunch(facts);
    if ("note" in launch && launch.note !== undefined) deps.say(launch.note);

    let eventsPath: string | null = null;
    if (launch.mode === "scope") {
      const memoryMax = deps.memoryMaxFor(gb);
      if (!deps.slice.setMemoryMax(request.slice, memoryMax)) {
        deps.say(
          `could not set ${request.slice} MemoryMax=${memoryMax}: the job runs without the slice's ceiling`,
        );
      }
      const group = deps.slice.controlGroup(request.slice);
      eventsPath = group === null ? null : `/sys/fs/cgroup${group}/memory.events`;
    }
    const before = eventsPath === null ? null : oomKills(deps.slice.readFile(eventsPath));

    const code = await deps.run(
      launchArgv(launch, sized, { kind, pid, slice: request.slice, startedAt: request.startedAt }),
    );

    const after = eventsPath === null ? null : oomKills(deps.slice.readFile(eventsPath));
    // The count is the whole slice's: another job's kill raises it too, so a job that
    // ended well (exit 0) was not the one killed.
    if (code !== 0 && before !== null && after !== null && after > before) {
      deps.say(
        `killed for memory: the heavy jobs running here together went over ${request.slice}'s ceiling, ` +
          `and the kernel stopped the largest. Run it again when fewer heavy jobs run (exit code ${String(code)}).`,
      );
    }
    return code;
  } finally {
    reservation.release();
  }
}
