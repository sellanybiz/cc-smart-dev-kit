/**
 * The fake `gh` for the Windows smoke test and its Linux test: it logs every argument and
 * answers the two questions the installer asks — whether the account this machine is logged in
 * with can see the repository (`gh repo view`, which fails the way gh does when it cannot), and
 * its login (`gh api user --jq .login`). Every other call succeeds, as before: the installer
 * only ever named `gh auth login` in a hint.
 *
 * It answers as gh does with NOBODY logged in too (`loggedOut`): both questions fail with gh's
 * own "please run: gh auth login" line on stderr and nothing on stdout — the machine the
 * installer must skip the check on, not stop. It is its own flag and not an empty `login`: the
 * smoke test sets its environment through [Environment]::SetEnvironmentVariable, and an empty
 * value cannot be relied on to arrive as an empty variable (Windows may drop it instead of
 * emptying it), which would silently fall back to the default login.
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
  /** Nobody is logged in: both questions fail the way gh fails with no account. */
  loggedOut?: boolean;
  /** `gh repo view` fails, as it does on an account that cannot see the repository. */
  viewFails?: boolean;
}

/** gh's own words with no account logged in, on stderr, exit 1 (seen live). */
const NOT_LOGGED_IN = "To get started with GitHub CLI, please run: gh auth login";

export function contextFromEnv(): Context {
  return {
    login: process.env.FAKE_GH_LOGIN ?? "example-user",
    log: process.env.FAKE_LOG ?? "",
    loggedOut: process.env.FAKE_GH_LOGGED_OUT === "yes",
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
    if (context.loggedOut === true) {
      sayError(NOT_LOGGED_IN);
      return 1;
    }
    if (context.viewFails === true) {
      // What gh answers on an account that cannot see the repository (live, 2026-10-17).
      sayError(`Could not resolve to a Repository with the name '${third ?? ""}'.`);
      return 1;
    }
    say(`{"name":"cc-smart-dev-kit"}`);
    return 0;
  }
  if (first === "api" && second === "user") {
    if (context.loggedOut === true) {
      sayError(NOT_LOGGED_IN);
      return 1;
    }
    say(context.login ?? "example-user");
    return 0;
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = answer(process.argv.slice(2), contextFromEnv());
}
