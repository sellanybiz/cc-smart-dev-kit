/**
 * The fake `gh` for the Windows smoke test and its Linux test: it logs every argument and
 * answers the two questions the installer asks — whether the account this machine is logged in
 * with can see the repository (`gh repo view`, which fails the way gh does when it cannot), and
 * its login (`gh api user --jq .login`). Every other call succeeds, as before: the installer
 * only ever named `gh auth login` in a hint.
 *
 * Every command takes a `context` (see `contextFromEnv`), so a test can point one at a world
 * of its own.
 */
import { appendFileSync } from "node:fs";

/** What the fake reads from the environment the smoke test builds. */
export interface Context {
  /** The login `gh api user --jq .login` prints. */
  login?: string;
  log: string;
  /** `gh repo view` fails, as it does on an account that cannot see the repository. */
  viewFails?: boolean;
}

export function contextFromEnv(): Context {
  return {
    login: process.env.FAKE_GH_LOGIN ?? "example-user",
    log: process.env.FAKE_LOG ?? "",
    viewFails: process.env.FAKE_GH_VIEW_FAILS === "yes",
  };
}

export function answer(
  argv: string[],
  context: Context,
  io: { error?: (line: string) => void; say?: (line: string) => void } = {},
): number {
  const say = io.say ?? ((line: string) => process.stdout.write(`${line}\n`));
  const sayError = io.error ?? ((line: string) => process.stderr.write(`${line}\n`));
  if (context.log !== "") appendFileSync(context.log, `gh ${argv.join(" ")}\n`);
  const [first, second, third] = argv;
  if (first === "repo" && second === "view") {
    if (context.viewFails === true) {
      // What gh answers on an account that cannot see the repository (live, 2026-10-17).
      sayError(`Could not resolve to a Repository with the name '${third ?? ""}'.`);
      return 1;
    }
    say(`{"name":"cc-smart-dev-kit"}`);
    return 0;
  }
  if (first === "api" && second === "user") {
    say(context.login ?? "example-user");
    return 0;
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = answer(process.argv.slice(2), contextFromEnv());
}
