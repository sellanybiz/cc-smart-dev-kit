/**
 * What the `crew` commands need from the machine, in one object, so a test hands in its own:
 * the paths (`cliPaths()`), the folder and the environment, the process tree above this command,
 * the free memory, and the program runner (a test runs the real one with a fake `claude` first on
 * PATH). `realCrewContext` is the CLI's.
 */
import { randomBytes } from "node:crypto";
import type { CliPaths } from "../cli/paths";
import { realMemoryFacts } from "../jobs/memory";
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
  runProgram: RunProgram;
  /** The full path of a command on PATH (`env.PATH`), or null. */
  which: (command: string) => null | string;
  /**
   * True when the person acts through the portal (D52): no Claude Code session runs this
   * command, and the portal's own environment may name the crew session that started it. Set
   * only by `src/portal/actions.ts`; a CLI run never sets it, so every refusal below stays.
   */
  asPerson?: boolean;
  /**
   * The machine's facts `crew rm` judges a worktree by: the running sessions, the programs and
   * the Docker containers. A test gives them; left out, they are read from the machine.
   */
  scanFacts?: ScanOptions["facts"];
  print: (line: string) => void;
  error: (line: string) => void;
}

/** The CLI's context: this process, this machine. */
export function realCrewContext(paths: CliPaths): CrewContext {
  const env = process.env;
  return {
    cwd: process.cwd(),
    env,
    error: (line) => console.error(line),
    freeMemoryGb: () => freeForCrewGb(paths.home, realMemoryFacts()),
    now: () => Date.now(),
    paths,
    pid: process.pid,
    platform: process.platform,
    print: (line) => console.log(line),
    processes: realProcessFacts(process.platform),
    randomSuffix: () => randomBytes(3).toString("hex"),
    readStdin: () => Bun.stdin.text(),
    runProgram: realRunProgram,
    sleep: (ms) => Bun.sleep(ms),
    which: (command) => Bun.which(command, { PATH: env.PATH ?? "" }),
  };
}
