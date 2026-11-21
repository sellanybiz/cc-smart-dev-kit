/**
 * Whether a job's output may go into a pipe (`bun test 2>&1 | tail`): the only way a pipe can
 * hide the job's own exit status, which is what the first waiting line's pipe hint says. A
 * stdout that is a FIFO (a shell's `|`) or a socket (what Bun's own spawn gives a child) may be
 * read by another program; a file or a terminal is not. On Windows the answer is not proved
 * (Bun's `fstat` of a pipe there is untested), so it counts as a pipe, and so does a stat that
 * fails: a hint too many is noise, a hint lost is a status the person never sees.
 */
import { fstatSync } from "node:fs";

/** The facts the answer reads, injectable for tests. */
export interface StdoutFacts {
  platform: NodeJS.Platform;
  /** Whether fd 1 is a FIFO or a socket; throws when it cannot be read. */
  isPipe: () => boolean;
}

const liveFacts: StdoutFacts = {
  platform: process.platform,
  isPipe: () => {
    const stat = fstatSync(1);
    return stat.isFIFO() || stat.isSocket();
  },
};

export function stdoutMayBePiped(facts: StdoutFacts = liveFacts): boolean {
  if (facts.platform === "win32") return true;
  try {
    return facts.isPipe();
  } catch {
    // Unknown: keep the hint (the header says why).
    return true;
  }
}
