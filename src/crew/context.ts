/**
 * What the `crew` commands need from the machine, in one object, so a test hands in its own:
 * the paths (`cliPaths()`), the folder and the environment, the process tree above this command,
 * the free memory, and the program runner (a test runs the real one with a fake `claude` first on
 * PATH). `realCrewContext` is the CLI's.
 */
import { randomBytes } from "node:crypto";
import type { CliPaths } from "../cli/paths";
import { realMemoryFacts } from "../jobs/memory";
import type { GhExec } from "../workflow/merge-check";
import { type LoadReading, machineLoad, realLoadFacts } from "../machine/load";
import type { CleanLock } from "../worktrees/clean";
import type { ScanOptions } from "../worktrees/scan";
import { type RunProgram, realRunProgram } from "./claude";
import { freeForCrewGb } from "./places";
import { type ProcessFacts, realProcessFacts } from "./session";

export type Env = Record<string, string | undefined>;

export interface CrewContext {
  paths: CliPaths;
  /** The folder the command runs in: the lead's own. */
  cwd: string;
  env: Env;
  platform: NodeJS.Platform;
  /** This process: the walk to the calling session starts here. */
  pid: number;
  processes: ProcessFacts;
  now: () => number;
  /** Waits `ms` milliseconds: the polls of the watch and the self-watch (a test hands in its own). */
  sleep: (ms: number) => Promise<void>;
  /** A short random suffix that keeps two crew sessions of one phase and slug apart in the store. */
  randomSuffix: () => string;
  /** All of stdin, for `--brief -`. */
  readStdin: () => Promise<string>;
  /** The memory a new crew session may use now, in GB; null where it cannot be read. */
  freeMemoryGb: () => Promise<null | number>;
  /** The CPU load now (`src/machine/load.ts`); null where the platform gives no load average. */
  load: () => LoadReading | null;
  runProgram: RunProgram;
  /** The full path of a command on PATH (`env.PATH`), or null. */
  which: (command: string) => null | string;
  /**
   * The `gh` a phase that starts from an issue reads and comments through (GI3). Left out: the
   * real one (`runGh`); a test hands in the fake GitHub, so none reaches GitHub.
   */
  gh?: GhExec;
  /**
   * The machine's facts `crew rm` judges a worktree by: the running sessions, the programs and
   * the Docker containers. A test gives them; left out, they are read from the machine.
   */
  scanFacts?: ScanOptions["facts"];
  /**
   * Takes the machine-wide lock of a worktree clean (`holdCleanLock`), or null when another clean
   * holds it. A test gives its own, so a clean running on the machine at that moment (another
   * suite's, the person's) cannot refuse its `crew rm`; left out, the machine's real lock.
   */
  holdCleanLock?: () => Promise<null | CleanLock>;
  /**
   * The parent of this process now, read again on every call: a watch ends when it changes, because
   * Claude Code ends a monitor by ending its shell and the watch is then re-parented (WF1). Left
   * out (a test's own context): the watch does not judge its parent.
   */
  parentPid?: () => null | number;
  /**
   * True once a line `print` wrote found nobody reading (EPIPE): a watch then ends (WF1). Left
   * out: never.
   */
  outputClosed?: () => boolean;
  print: (line: string) => void;
  error: (line: string) => void;
}

/** What a writer to stdout needs: a stream with Node's `write`, its callback and its error event. */
interface Writable {
  on: (event: "error", listener: (error: Error) => void) => unknown;
  write: (text: string, done: (error?: Error | null) => void) => unknown;
}

/**
 * A printer to `stream` that notices when nobody reads it any more (proved on Bun 1.4.3, a real
 * closed pipe). Bun's `console.log` drops such a write without a word. `process.stdout.write`
 * tells its callback (EPIPE) and emits `error` — and an `error` nobody listens to ends the
 * process at once, with a stack trace, wherever it next prints. So the printer listens: the
 * failure is kept, never thrown, and `closed` says it.
 */
export function stdoutPrinter(stream: Writable): {
  closed: () => boolean;
  print: (line: string) => void;
} {
  let failed = false;
  stream.on("error", () => {
    failed = true;
  });
  return {
    closed: () => failed,
    print: (line) => {
      stream.write(`${line}\n`, (error) => {
        if (error) failed = true;
      });
    },
  };
}

/** The CLI's context: this process, this machine. */
export function realCrewContext(paths: CliPaths): CrewContext {
  const env = process.env;
  const stdout = stdoutPrinter(process.stdout);
  return {
    cwd: process.cwd(),
    env,
    error: (line) => console.error(line),
    freeMemoryGb: () => freeForCrewGb(paths.home, realMemoryFacts()),
    load: () => machineLoad(realLoadFacts()),
    now: () => Date.now(),
    outputClosed: stdout.closed,
    parentPid: () => process.ppid,
    paths,
    pid: process.pid,
    platform: process.platform,
    print: stdout.print,
    processes: realProcessFacts(process.platform),
    randomSuffix: () => randomBytes(3).toString("hex"),
    readStdin: () => Bun.stdin.text(),
    runProgram: realRunProgram,
    sleep: (ms) => Bun.sleep(ms),
    which: (command) => Bun.which(command, { PATH: env.PATH ?? "" }),
  };
}
