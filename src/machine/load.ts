/**
 * How busy this machine's CPU is right now: the 1-minute load average and the cores it is
 * measured against. The crew start gate holds a new crew session while the load is far past the
 * cores (`workflow.crew.loadPerCore`, `src/crew/places.ts`). This is the one reader; a test hands
 * in `LoadFacts` of its own.
 *
 * Native Windows has no load average (`os.loadavg()` answers zeros there), so no reading is
 * given and the hold does not apply.
 */
import { availableParallelism, loadavg } from "node:os";

/** What the machine says about its CPU; a test fakes it. */
export interface LoadFacts {
  /** `os.availableParallelism()`: the cores this process may run on. */
  cores: () => number;
  /** `os.loadavg()`: the 1, 5 and 15 minute averages. */
  loadavg: () => number[];
  platform: NodeJS.Platform;
}

/** The 1-minute load average, and the cores it is measured against. */
export interface LoadReading {
  cores: number;
  oneMinute: number;
}

export function realLoadFacts(): LoadFacts {
  return { cores: availableParallelism, loadavg, platform: process.platform };
}

/** The load now, or null where the platform gives no load average or the reading is not a number. */
export function machineLoad(facts: LoadFacts): LoadReading | null {
  if (facts.platform === "win32") return null;
  const oneMinute = facts.loadavg()[0];
  const cores = facts.cores();
  if (oneMinute === undefined || !Number.isFinite(oneMinute) || !(cores >= 1)) return null;
  return { cores, oneMinute };
}

/** The load above which a start waits: `loadPerCore` for each core. */
export function loadLimit(reading: LoadReading, loadPerCore: number): number {
  return reading.cores * loadPerCore;
}

/** The one line that says the load hold does not apply, said once by `crew list`. */
export function loadUnreadLine(): string {
  return "note: this platform gives no load average, so a crew start does not wait for the CPU (workflow.crew.loadPerCore does not apply)";
}
