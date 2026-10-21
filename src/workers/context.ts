/**
 * What the `worker` commands need from the machine, in one object, so a test hands in its own:
 * the paths (`cliPaths()`), the folder and the environment, the process tree above this command,
 * the free memory, and the program runner (a test runs the real one with a fake `claude` first on
 * PATH). `realWorkerContext` is the CLI's.
 */
import { randomBytes } from "node:crypto";
import type { CliPaths } from "../cli/paths";
import { realMemoryFacts } from "../jobs/memory";
import { type RunProgram, realRunProgram } from "./claude";
import { freeForWorkersGb } from "./places";
import { type ProcessFacts, realProcessFacts } from "./session";

export type Env = Record<string, string | undefined>;

export interface WorkerContext {
  paths: CliPaths;
  /** The folder the command runs in: the lead's own. */
  cwd: string;
  env: Env;
  platform: NodeJS.Platform;
  /** This process: the walk to the calling session starts here. */
  pid: number;
  processes: ProcessFacts;
  now: () => number;
  /** A short random suffix that keeps two workers of one phase and slug apart in the store. */
  randomSuffix: () => string;
  /** All of stdin, for `--brief -`. */
  readStdin: () => Promise<string>;
  /** The memory a new worker may use now, in GB; null where it cannot be read. */
  freeMemoryGb: () => Promise<null | number>;
  runProgram: RunProgram;
  /** The full path of a command on PATH (`env.PATH`), or null. */
  which: (command: string) => null | string;
  print: (line: string) => void;
  error: (line: string) => void;
}

/** The CLI's context: this process, this machine. */
export function realWorkerContext(paths: CliPaths): WorkerContext {
  const env = process.env;
  return {
    cwd: process.cwd(),
    env,
    error: (line) => console.error(line),
    freeMemoryGb: () => freeForWorkersGb(paths.home, realMemoryFacts()),
    now: () => Date.now(),
    paths,
    pid: process.pid,
    platform: process.platform,
    print: (line) => console.log(line),
    processes: realProcessFacts(process.platform),
    randomSuffix: () => randomBytes(3).toString("hex"),
    readStdin: () => Bun.stdin.text(),
    runProgram: realRunProgram,
    which: (command) => Bun.which(command, { PATH: env.PATH ?? "" }),
  };
}
