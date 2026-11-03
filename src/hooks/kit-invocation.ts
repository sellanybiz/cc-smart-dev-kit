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
 * review-done` by hand) and `job-route` (`workflow propose`, where the push gate says the push
 * or the pull request is the person's). So the recogniser lives here, once, and both import it
 * — never a copy (`.claude/rules/hooks-guards.md` § A machine-wide hook).
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

/**
 * The kit command as a token of a line's text (`K=${COMMAND}; $(which $K) …` names it too,
 * and so does a launcher named by its path, `/…/bin/${COMMAND}` or `${COMMAND}.cmd`), but never
 * a path that only passes through a folder of that name: a path separator may come before the
 * name and never after it, so `/repo/${COMMAND}/src/x.test.ts` is an argument to another
 * program, and the computed program beside it runs that program (the false alarm of 1.1.0, in
 * a session working in this repository, whose name every path holds). A token that ends a
 * word still counts when a substitution or an assignment closes it (`$(which ${COMMAND})`,
 * `K=${COMMAND}`).
 */
const KIT_TOKEN = new RegExp(
  `(^|[^\\w.-])${COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.(?:exe|cmd|ps1|bat))?(?=$|[^\\w.\\-/\\\\])`,
  "i",
);

/** Where a path in a line's text ends: a space, a quote, an assignment, a separator, a substitution. */
const PATH_BREAKS = /[\s"'`=;&|<>()]+/;

/**
 * True when a line's text names the kit command: as a token (`KIT_TOKEN`), or by a path to its
 * bundle (`KIT_BUNDLE`) written anywhere in it, a variable's value included
 * (`C=…/dist/cli.js; $(which bun) $C …`: the bundle word `$C` is no kit word, and the folder
 * `KIT_TOKEN` ignores held the name). A guard that meets a program the line works out when it
 * runs (`$PY`, `$(which gh)`) reads that program as the kit only when this is true: without it,
 * the words around a computed program are another program's (`"$PY" -m pytest -k workflow`),
 * and a guard that read them as the kit's would ask or refuse a test run. `session-escape-guard`
 * and `job-route`'s judge share this one test.
 *
 * **It leans toward yes, on purpose.** A line that holds the kit's bundle as another program's
 * argument (`"$PY" -m pytest src/entries/cli.ts`) or a folder that ends in the kit's name
 * (`cd /repo/cc-smart-dev-kit && "$PY" …`) names it too. A text test cannot tell those from the
 * same words as a variable's value (`B="${PLUGIN_ROOT}/dist/cli.js"; … $B`, `K=/opt/tools/${COMMAND}`),
 * and a narrower rule — a folder of the kit's name above the bundle, a launcher only under `bin/` —
 * would let those real spellings past a guard that fails closed. The cost of the wide rule is one
 * question about a computed program on a line with a stray kit path.
 */
export function namesKit(text: string): boolean {
  return KIT_TOKEN.test(text) || text.split(PATH_BREAKS).some((piece) => KIT_BUNDLE.test(piece));
}

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
