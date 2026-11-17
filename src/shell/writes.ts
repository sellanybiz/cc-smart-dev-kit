/**
 * What a shell line writes: the one reader of the places a command line changes, as far as the
 * shell reader can tell. The main-folder guard asks it (`writeTargets`), so a session that must
 * not change the main checkout cannot do it with `echo x > a.txt` or `git commit` instead of the
 * Edit tool; the session-escape guard asks it (`writtenWords`) for writes into the kit's own
 * files.
 *
 * What it names:
 * - the target of a redirection (`>`, `>>`, `&>`, `<>`);
 * - the files `tee`, `sed -i`, `perl -i`, `dd of=`, `cp` (its destination), `mv` (both ends),
 *   `install`, `rm`, `rmdir`, `touch`, `mkdir` and `ln` (the link) change, and what PowerShell's
 *   `Set-Content`, `Add-Content`, `Out-File`, `Tee-Object`, `Copy-Item` and `Move-Item` write;
 * - for a git command that changes the work tree or its branch (`checkout`, `commit`, `pull` …),
 *   the folder git runs in: `-C` and `--work-tree` are followed (`writeTargets` only).
 *
 * `writeTargets` gives absolute paths, worked out in the folder their command runs in (a `cd`
 * earlier on the line moves it, a `( … )` keeps its `cd` to itself). A word the shell fills in
 * when the line runs (`$OUT`, `$(pwd)`, `~/x`) names nothing the reader can know, so it is left
 * out: this reads what is written, never guesses. A program it does not know writes nothing it
 * can name (`find -delete`, `xargs rm`, a script). One thing it does not let by: a program the
 * line works out when it runs (`$GIT commit`) whose words name a git command that changes the
 * checkout, which comes back marked `computed`.
 */
import { basename, isAbsolute, resolve } from "node:path";
import { CHANGES_FOLDER, FolderTracker, movedTo } from "./change-dir";
import {
  type Dialect,
  type Invocation,
  invocationOf,
  isShort,
  MAX_NESTING,
  nestedCommand,
  nestedDialect,
  type Reading,
  readingsOf,
  redirectionTargets,
  shellSteps,
  shortFlags,
  withoutRedirections,
  wordsOf,
} from "./command";
import { type GitCall, gitCalls, longOption } from "./git-calls";

/** The options of one program that take a value, so the word after one is not an operand. */
interface OptionSpec {
  /** The short option letters that take a value (`-t DIR`; the rest of the group may be it). */
  short: string;
  /** The long options that take a value (`--target-directory DIR`; `=` may attach it). */
  long: readonly string[];
  /** The short letters whose attached rest is an optional value (`sed -i.bak`), never the next word. */
  suffix?: string;
}

interface Scanned {
  operands: string[];
  /** The value of `-t` / `--target-directory`, the folder `cp`, `mv` and `ln` put files in. */
  targetDirectory: string | null;
  /** Every short option letter given, in any group (not a value, not a suffix). */
  letters: string;
  /** Every long option given, as the word wrote it, without its `=value`. */
  longs: string[];
}

/**
 * The words that are no option, and the options the program's writes depend on. In PowerShell
 * (`named`) a `-Name` is one parameter, not a group of letters.
 */
function scan(args: readonly string[], spec: OptionSpec, named = false): Scanned {
  const scanned: Scanned = { operands: [], targetDirectory: null, letters: "", longs: [] };
  let optionsEnded = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (optionsEnded || !arg.startsWith("-") || arg === "-") {
      scanned.operands.push(arg);
    } else if (arg === "--") {
      optionsEnded = true;
    } else if (named && /^-[A-Za-z]+(?::|$)/.test(arg)) {
      scanned.longs.push(arg.split(":")[0] ?? arg);
    } else if (arg.startsWith("--")) {
      const name = arg.split("=")[0] ?? arg;
      scanned.longs.push(name);
      // GNU programs take any unique prefix of a long option (`--target` is `--target-directory`).
      const full = spec.long.find(
        (long) => long === name || (name.length >= 4 && long.startsWith(name)),
      );
      if (full === undefined) continue;
      const value = arg.includes("=") ? arg.slice(name.length + 1) : args[++index];
      if (full === "--target-directory" && value !== undefined) scanned.targetDirectory = value;
    } else {
      for (let at = 1; at < arg.length; at++) {
        const letter = arg.charAt(at);
        scanned.letters += letter;
        if (spec.suffix?.includes(letter)) break;
        if (!spec.short.includes(letter)) continue;
        const value = at === arg.length - 1 ? args[++index] : arg.slice(at + 1);
        if (letter === "t" && value !== undefined) scanned.targetDirectory = value;
        break;
      }
    }
  }
  return scanned;
}

/** The values of the PowerShell parameters `names` (any prefix of a name: `-Dest`, `-Path:x`). */
function parameterValues(args: readonly string[], names: readonly string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const parameter = /^-([a-z]+)(?::(.*))?$/i.exec(args[index] ?? "");
    const given = parameter?.[1]?.toLowerCase() ?? "";
    if (given.length < 2 || !names.some((name) => name.startsWith(given))) continue;
    const value = parameter?.[2] ?? args[++index];
    if (value !== undefined) values.push(value);
  }
  return values;
}

const NO_VALUES: OptionSpec = { short: "", long: [] };
const COPY_OPTIONS: OptionSpec = { short: "tS", long: ["--target-directory", "--suffix"] };
const INSTALL_OPTIONS: OptionSpec = {
  short: "mogtS",
  long: ["--mode", "--owner", "--group", "--target-directory", "--suffix"],
};
const SED_OPTIONS: OptionSpec = {
  short: "efl",
  long: ["--expression", "--file", "--line-length"],
  suffix: "i",
};
const PERL_OPTIONS: OptionSpec = { short: "eEIMmCDdFVx", long: [], suffix: "i" };

/** The programs that change every operand they are given, and the options of theirs that take a value. */
const CHANGES_OPERANDS: ReadonlyMap<string, OptionSpec> = new Map([
  ["mkdir", { short: "m", long: ["--mode", "--context"] }],
  ["rm", NO_VALUES],
  ["rmdir", NO_VALUES],
  ["tee", NO_VALUES],
  ["touch", { short: "dtr", long: ["--date", "--reference", "--time"] }],
]);

/** PowerShell's cmdlets (and their aliases) that write the file they are given, each non-option word. */
const WRITES_ITS_FILES: ReadonlySet<string> = new Set([
  "ac",
  "add-content",
  "out-file",
  "sc",
  "set-content",
  "tee-object",
]);

/** Programs that put their last argument (or `-t` / `-Destination`) in place. */
const COPIES: ReadonlySet<string> = new Set([
  "copy",
  "copy-item",
  "cp",
  "cpi",
  "install",
  "ln",
  "mi",
  "move",
  "move-item",
  "mv",
]);

/** The ones among them that also take their source away: every argument is written. */
const MOVES: ReadonlySet<string> = new Set(["mi", "move", "move-item", "mv"]);

/** The words a copy, move or link puts something at. */
function copyWords(program: string, args: readonly string[], dialect: Dialect): string[] {
  const spec = program === "install" ? INSTALL_OPTIONS : COPY_OPTIONS;
  const { operands, targetDirectory, letters } = scan(args, spec, dialect === "powershell");
  // `install -d a b` makes the folders themselves.
  if (program === "install" && letters.includes("d")) return operands;
  const given = [
    ...parameterValues(args, ["destination"]),
    ...(targetDirectory === null ? [] : [targetDirectory]),
  ];
  const sources = given.length > 0 ? operands : operands.slice(0, -1);
  let destination: string[] = given;
  if (given.length === 0) {
    // `ln target`: the link is made in the working folder, named like the target.
    const last =
      program === "ln" && operands.length === 1 ? basename(operands[0] ?? "") : operands.at(-1);
    destination = last === undefined || last === "" ? [] : [last];
  }
  // A move takes its sources away too: they are changed as much as its destination.
  return MOVES.has(program) ? [...destination, ...sources] : destination;
}

/** The files `sed -i` / `perl -i` edit in place; none without `-i`. */
function inPlaceWords(program: string, args: readonly string[]): string[] {
  const { operands, letters, longs } = scan(args, program === "sed" ? SED_OPTIONS : PERL_OPTIONS);
  const inPlace =
    letters.includes("i") ||
    (program === "sed" && longs.some((name) => name.length >= 3 && "--in-place".startsWith(name)));
  if (!inPlace) return [];
  // BSD `sed -i '' s/x/y/ file`: the empty word is the backup suffix, not a file.
  const words = operands.filter((word) => word !== "");
  const scripted =
    program === "sed"
      ? /[ef]/.test(letters) || longs.some((name) => ["--expression", "--file"].includes(name))
      : /[eE]/.test(letters);
  // With no -e, the first word is the script (`sed -i s/a/b/ file`, `perl -i script.pl file`).
  return scripted ? words : words.slice(1);
}

/**
 * The words one command writes, as the line spells them (not git: it writes a folder). `words`
 * are all the step's words (a redirection may stand before the program).
 */
export function writtenWords(
  words: readonly string[],
  invocation: Invocation | undefined,
  dialect: Dialect = "bash",
): string[] {
  const written = redirectionTargets(words);
  if (invocation === undefined) return written;
  const { program } = invocation;
  const args = withoutRedirections(invocation.args);
  const operandSpec = CHANGES_OPERANDS.get(program);
  if (operandSpec !== undefined) written.push(...scan(args, operandSpec).operands);
  else if (WRITES_ITS_FILES.has(program))
    written.push(...args.filter((arg) => !arg.startsWith("-")));
  else if (program === "dd")
    written.push(...args.filter((arg) => arg.startsWith("of=")).map((arg) => arg.slice(3)));
  else if (program === "sed" || program === "perl") written.push(...inPlaceWords(program, args));
  else if (COPIES.has(program)) written.push(...copyWords(program, args, dialect));
  return written;
}

/** The git subcommands that change the work tree, the index or the branch checked out. */
const GIT_CHANGES_CHECKOUT = new Set([
  "am",
  "apply",
  "checkout",
  "cherry-pick",
  "clean",
  "commit",
  "merge",
  "mv",
  "pull",
  "rebase",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "switch",
]);

/** The options before `--`: after it git reads paths. */
function optionsOf(rest: readonly string[]): readonly string[] {
  const dashes = rest.indexOf("--");
  return dashes === -1 ? rest : rest.slice(0, dashes);
}

/** True when `rest` holds the long option `name`, or one of its unique prefixes of `min` letters or more. */
function hasLong(rest: readonly string[], name: string, min: number): boolean {
  return optionsOf(rest).some((arg) => arg.startsWith("--") && longOption(arg, name, min));
}

/** True when `rest` holds the short option `letter`, alone or in a group. */
function hasShort(rest: readonly string[], letter: string): boolean {
  return optionsOf(rest).some((arg) => isShort(arg) && shortFlags(arg, "").flags.includes(letter));
}

/** True when this git call changes the work tree or its branch (not a read, a dry run or a check). */
function changesCheckout(call: GitCall): boolean {
  const { rest, sub } = call;
  if (!GIT_CHANGES_CHECKOUT.has(sub)) return false;
  switch (sub) {
    case "stash": {
      const action = rest.find((arg) => !arg.startsWith("-"));
      return action !== "list" && action !== "show";
    }
    case "clean":
      return !(hasLong(rest, "--dry-run", 4) || hasShort(rest, "n"));
    case "apply":
      return !["--check", "--stat", "--numstat", "--summary"].some((name) =>
        hasLong(rest, name, 4),
      );
    case "commit":
    case "pull":
      return !hasLong(rest, "--dry-run", 4);
    case "checkout":
      // Bare `git checkout` only lists what differs.
      return rest.length > 0;
    default:
      return true;
  }
}

/** The folder a git call runs in, after its `-C` and `--work-tree`; null when it cannot be told. */
function gitFolder(call: GitCall, folder: string | null): string | null {
  let at = folder;
  for (const dir of call.dirs) at = movedTo("cd", at, [dir]);
  return call.workTree === null || at === null ? at : movedTo("cd", at, [call.workTree]);
}

/** One place a line writes. */
export interface WriteTarget {
  /** An absolute path: a file, or the folder a git command runs in. */
  path: string;
  /**
   * The program is worked out when the line runs (`$GIT commit`), so only its words say it
   * changes the checkout: a caller asks about it instead of refusing it.
   */
  computed: boolean;
}

/** The words of `words` as absolute paths in `folder`; a word the reader cannot know is left out. */
function inFolder(folder: string | null, words: readonly string[]): string[] {
  return words.flatMap((word) => {
    if (word === "" || /^[~%]|[$`]/.test(word)) return [];
    if (isAbsolute(word)) return [resolve(word)];
    return folder === null ? [] : [resolve(folder, word)];
  });
}

/** The places one command of the line writes, in the folder it runs in. */
function stepWrites(
  words: readonly string[],
  invocation: Invocation,
  folder: string | null,
  dialect: Dialect,
): WriteTarget[] {
  const { computed, program } = invocation;
  const operands = withoutRedirections(invocation.args);
  const redirected = redirectionTargets(words);
  const files = inFolder(folder, redirected);
  if (program === "git" || computed) {
    const folders = gitCalls(operands)
      .filter(changesCheckout)
      .flatMap((call) => gitFolder(call, folder) ?? []);
    // `$(which git) checkout x`: the substitution's words run on, so git's own options cannot
    // be read; a word that names the subcommand says the line may change the checkout.
    if (
      computed &&
      folders.length === 0 &&
      folder !== null &&
      operands.some((word) => GIT_CHANGES_CHECKOUT.has(word))
    ) {
      folders.push(folder);
    }
    return [
      ...files.map((path) => ({ computed: false, path })),
      ...folders.map((path) => ({ computed: program !== "git", path })),
    ];
  }
  return inFolder(folder, writtenWords(words, invocation, dialect)).map((path) => ({
    computed: false,
    path,
  }));
}

/** The places the commands of `command` write, read one way (`reading`); nested commands too. */
function inspect(command: string, cwd: string | null, reading: Reading, depth = 0): WriteTarget[] {
  const found: WriteTarget[] = [];
  const tracker = new FolderTracker(cwd);
  const { dialect, joinLines } = reading;
  // A quote left open is read blind: more pieces, so nothing hides inside it.
  for (const step of shellSteps(command, { blindWhenOpen: true, dialect, joinLines })) {
    const folder = tracker.enter(step.subshellDepth ?? 0);
    const words = wordsOf(step.text, dialect);
    const invocation = invocationOf(words);
    if (invocation === undefined) {
      found.push(
        ...inFolder(folder, redirectionTargets(words)).map((path) => ({ computed: false, path })),
      );
      continue;
    }
    const { args, program } = invocation;
    found.push(...stepWrites(words, invocation, folder, dialect));
    if (CHANGES_FOLDER.has(program)) {
      tracker.moveTo(movedTo(program, folder, withoutRedirections(args), { dialect }));
    }
    const inner = nestedCommand(program, args, step.pipedFrom);
    if (inner !== undefined && depth < MAX_NESTING) {
      for (const nested of readingsOf(inner, nestedDialect(program))) {
        found.push(...inspect(inner, folder, nested, depth + 1));
      }
    }
  }
  return found;
}

/**
 * The places `command` writes, each once, when run in `cwd` (null: a folder the caller does not
 * know, so only absolute paths count). The line is read every way it may run (`readingsOf`), as
 * the git guard reads it.
 */
export function writeTargets(
  command: string,
  cwd: string | null,
  dialect?: Dialect,
): WriteTarget[] {
  const seen = new Set<string>();
  return readingsOf(command, dialect)
    .flatMap((reading) => inspect(command, cwd, reading))
    .filter((target) => {
      const key = `${target.computed ? "?" : "="}${target.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
