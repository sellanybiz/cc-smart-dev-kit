/**
 * The fake `git` for the Windows smoke test and its Linux test: it logs every argument and
 * answers the installer's `ls-remote` check — succeeding, or failing on purpose when
 * FAKE_GIT_FAILS is "yes" (a machine whose credentials are not set up).
 *
 * Every command takes a `context` (see `contextFromEnv`), so a test can point one at a world
 * of its own.
 */
import { appendFileSync } from "node:fs";

/** What the fake reads from the environment the smoke test builds. */
export interface Context {
  gitFails: boolean;
  log: string;
}

export function contextFromEnv(): Context {
  return {
    gitFails: process.env.FAKE_GIT_FAILS === "yes",
    log: process.env.FAKE_LOG ?? "",
  };
}

export function answer(argv: string[], context: Context): number {
  if (context.log !== "") appendFileSync(context.log, `git ${argv.join(" ")}\n`);
  return context.gitFails ? 128 : 0;
}

if (import.meta.main) {
  process.exitCode = answer(process.argv.slice(2), contextFromEnv());
}
