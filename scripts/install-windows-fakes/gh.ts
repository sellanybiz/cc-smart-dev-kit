/**
 * The fake `gh` for the Windows smoke test and its Linux test: it logs every argument and
 * succeeds. The installer never runs it (it only names `gh auth login` in a hint), but a
 * machine may have it on PATH, and the smoke test wants every program the installer could
 * reach to be a fake.
 *
 * Every command takes a `context` (see `contextFromEnv`), so a test can point one at a world
 * of its own.
 */
import { appendFileSync } from "node:fs";

/** What the fake reads from the environment the smoke test builds. */
export interface Context {
  log: string;
}

export function contextFromEnv(): Context {
  return { log: process.env.FAKE_LOG ?? "" };
}

export function answer(argv: string[], context: Context): number {
  if (context.log !== "") appendFileSync(context.log, `gh ${argv.join(" ")}\n`);
  return 0;
}

if (import.meta.main) {
  process.exitCode = answer(process.argv.slice(2), contextFromEnv());
}
