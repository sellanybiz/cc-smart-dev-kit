import { join } from "node:path";

/** One heavy run at a time on this machine. Not configurable. */
export const HEAVY_SLOTS = 1;

/** The local lease folder. Old jobs.json settings are never read. */
export function jobsPaths(home: string): { stateDir: string } {
  return { stateDir: join(home, ".local", "share", "cc-smart-dev-kit", "jobs") };
}
