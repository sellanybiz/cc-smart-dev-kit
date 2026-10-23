/**
 * What a shell step runs of the kit's own command — one recogniser for every guard that asks.
 *
 * The kit's command is one program under many spellings: its name (`cc-smart-dev-kit`), a path
 * to the launcher (`~/.local/bin/cc-smart-dev-kit`, `sh …/bin/cc-smart-dev-kit`), or its bundle
 * behind another program (`bun …/dist/cli.js workflow …`, the shim `…/bin/cc-smart-dev-kit-bun.sh
 * …/dist/cli.js …`), and a program that runs its arguments may hold it (`find . -exec
 * cc-smart-dev-kit … \;`, `watch -n 5 cc-smart-dev-kit …`).
 *
 * Two guards ask, for two different reasons, and a spelling that gets past one must not get past
 * the other: `session-escape-guard` (a kit command run with `CLAUDECODE` unset, `workflow
 * review-done` by hand) and `job-route` (a crew session's `crew start` and `workflow propose`,
 * D24). So the recogniser lives here, once, and both import it — never a copy
 * (`.claude/rules/hooks-guards.md` § A crew session's own limits).
 */
import { COMMAND } from "../build-info/names";
import { programName } from "../shell/command";

/**
 * Programs that only read, search or move their arguments, never run them: a path to the kit
 * command after `ls` or `grep` is text, not a command. Everything else that has the kit
 * command among its arguments may run it (`find . -exec …`, `watch …`, `parallel …`).
 */
const INERT: ReadonlySet<string> = new Set([
  "[",
  "[[",
  "awk",
  "cat",
  "chmod",
  "chown",
  "cp",
  "diff",
  "echo",
  "egrep",
  "fgrep",
  "file",
  "git",
  "grep",
  "head",
  "less",
  "ln",
  "ls",
  "man",
  "mkdir",
  "more",
  "mv",
  "printf",
  "readlink",
  "realpath",
  "rg",
  "rm",
  "sed",
  "stat",
  "tail",
  "tee",
  "test",
  "touch",
  "type",
  "wc",
  "which",
]);

/** A bundle that is the kit's command or its portal, run by path (`bun …/dist/cli.js`). */
const KIT_BUNDLE = /(?:^|[\\/])(?:dist|entries)[\\/](?:cli|portal)\.(?:js|ts)$/;

/** True when a word names the kit command: the launcher by name or path, or its bundle. */
export function isKitWord(word: string): boolean {
  return programName(word) === COMMAND || KIT_BUNDLE.test(word);
}

/**
 * The arguments of the kit command a program runs, or null when it runs none: the program
 * is the kit command, or has it among its arguments (`bun …/dist/cli.js workflow …`,
 * `find . -exec cc-smart-dev-kit … \;`) and is not one that only reads its arguments.
 */
export function kitArguments(program: string, args: readonly string[]): string[] | null {
  if (programName(program) === COMMAND) return [...args];
  if (INERT.has(program)) return null;
  const at = args.findIndex(isKitWord);
  return at === -1 ? null : args.slice(at + 1);
}
