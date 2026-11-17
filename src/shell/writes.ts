/**
 * What a shell line writes: the places a command line changes, as far as the one shell reader
 * can tell. The main-folder guard asks it, so a session that must not change the main checkout
 * cannot do it with `echo x > a.txt` or `git commit` instead of the Edit tool.
 *
 * A place is an absolute path, worked out in the folder its command runs in (a `cd` earlier on
 * the line moves it). What it names:
 * - the target of a redirection (`>`, `>>`, `&>`, `<>`);
 * - the files `tee`, `sed -i`, `cp` (its destination), `mv` (both ends), `rm`, `rmdir`, `touch`,
 *   `mkdir` and `ln` (the link) change;
 * - for a git command that changes the work tree or its branch (`checkout`, `commit`, `pull` …),
 *   the folder git runs in: `-C` and `--work-tree` are followed.
 *
 * A word the shell fills in when the line runs (`$OUT`, `$(pwd)`, `~/x`) names nothing the
 * reader can know, so it is left out: this reads what is written, never guesses. A program it
 * does not know writes nothing it can name (`find -delete`, `xargs rm`, a script).
 */
import { basename, isAbsolute, resolve } from "node:path";
import { movedTo } from "./change-dir";
import {
  CHANGE_DIR,
  type Dialect,
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
import { type GitCall, gitCalls } from "./git-calls";

/** The options of one program that take a value, so the word after one is not an operand. */
interface OptionSpec {
  /** The short option letters that take a value (`-t DIR`; the rest of the group may be it). */
  short: string;
  /** The long options that take a value (`--target-directory DIR`; `=` may attach it). */
  long: readonly string[];
}

interface Scanned {
  operands: string[];
  /** The value of `-t` / `--target-directory`, the folder `cp`, `mv` and `ln` put files in. */
  targetDirectory: string | null;
  /** Every short option letter given, in any group. */
  letters: string;
  /** Every long option given, as the word wrote it, without its `=value`. */
  longs: string[];
}

/** The words that are no option, and the options the program's writes depend on. */
function scan(args: readonly string[], spec: OptionSpec): Scanned {
  const scanned: Scanned = { operands: [], targetDirectory: null, letters: "", longs: [] };
  let optionsEnded = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (optionsEnded || !arg.startsWith("-") || arg === "-") {
      scanned.operands.push(arg);
    } else if (arg === "--") {
      optionsEnded = true;
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
      const group = shortFlags(arg, spec.short);
      scanned.letters += group.flags;
      const last = group.flags.slice(-1);
      if (last === "" || !spec.short.includes(last)) continue;
      const value = group.wantsNext ? args[++index] : group.value;
      if (last === "t" && value !== undefined) scanned.targetDirectory = value;
    }
  }
  return scanned;
}

const NO_VALUES: OptionSpec = { short: "", long: [] };
const COPY_OPTIONS: OptionSpec = { short: "tS", long: ["--target-directory", "--suffix"] };
const SED_OPTIONS: OptionSpec = {
  short: "efl",
  long: ["--expression", "--file", "--line-length"],
};

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

/**
 * True when `rest` holds the long option `name` (git takes any unique prefix of it, four
 * characters or more) or, when `letter` is given, that short letter in a group.
 */
function hasOption(rest: readonly string[], name: string, letter?: string): boolean {
  const dashes = rest.indexOf("--");
  const options = dashes === -1 ? rest : rest.slice(0, dashes);
  return options.some((arg) => {
    const given = arg.split("=")[0] ?? arg;
    if (arg.startsWith("--")) return given.length >= 4 && name.startsWith(given);
    return letter !== undefined && isShort(arg) && shortFlags(arg, "").flags.includes(letter);
  });
}

/** True when this git call changes the work tree or its branch (not a read, a dry run or a check). */
function changesCheckout(call: GitCall): boolean {
  if (!GIT_CHANGES_CHECKOUT.has(call.sub)) return false;
  const { rest, sub } = call;
  if (sub === "stash") {
    const action = rest.find((arg) => !arg.startsWith("-"));
    return action !== "list" && action !== "show";
  }
  if (sub === "clean") return !hasOption(rest, "--dry-run", "n");
  if (sub === "apply") {
    return !["--check", "--stat", "--numstat", "--summary"].some((name) => hasOption(rest, name));
  }
  return true;
}

/** The folder a git call runs in, after its `-C` and `--work-tree`; null when it cannot be told. */
function gitFolder(call: GitCall, folder: string | null): string | null {
  let at = folder;
  for (const dir of call.dirs) at = movedTo("cd", at, [dir]);
  return call.workTree === null || at === null ? at : movedTo("cd", at, [call.workTree]);
}

/** The words of `operands` as absolute paths in `folder`; a word the reader cannot know is left out. */
function inFolder(folder: string | null, words: readonly string[]): string[] {
  return words.flatMap((word) => {
    if (word === "" || /^[~%]|[$`]/.test(word)) return [];
    if (isAbsolute(word)) return [resolve(word)];
    return folder === null ? [] : [resolve(folder, word)];
  });
}

/** The programs that change every operand they are given, and the options of theirs that take a value. */
const CHANGES_OPERANDS: ReadonlyMap<string, OptionSpec> = new Map([
  ["mkdir", { short: "m", long: ["--mode", "--context"] }],
  ["rm", NO_VALUES],
  ["rmdir", NO_VALUES],
  ["tee", NO_VALUES],
  ["touch", { short: "dtr", long: ["--date", "--reference", "--time"] }],
]);

/** The words a program changes, from its operands; empty for a program that changes no file. */
function writtenWords(program: string, operands: readonly string[]): string[] {
  const spec = CHANGES_OPERANDS.get(program);
  if (spec !== undefined) return scan(operands, spec).operands;
  switch (program) {
    case "sed": {
      const { operands: files, letters, longs } = scan(operands, SED_OPTIONS);
      if (
        !letters.includes("i") &&
        !longs.some((name) => name.length >= 3 && "--in-place".startsWith(name))
      ) {
        return [];
      }
      const scripted =
        letters.includes("e") ||
        letters.includes("f") ||
        longs.some((name) => ["--expression", "--file"].includes(name));
      return scripted ? files : files.slice(1);
    }
    case "cp":
    case "mv": {
      const { operands: paths, targetDirectory } = scan(operands, COPY_OPTIONS);
      const destination = targetDirectory ?? (paths.length >= 2 ? paths.at(-1) : undefined);
      // `mv` takes its sources away too: they are changed as much as its destination.
      const sources = targetDirectory === null ? paths.slice(0, -1) : paths;
      return [
        ...(destination === undefined ? [] : [destination]),
        ...(program === "mv" ? sources : []),
      ];
    }
    case "ln": {
      const { operands: paths, targetDirectory } = scan(operands, COPY_OPTIONS);
      if (targetDirectory !== null) return [targetDirectory];
      // `ln target`: the link is made in the working folder, named like the target.
      const link = paths.length === 1 ? basename(paths[0] ?? "") : paths.at(-1);
      return link === undefined || link === "" ? [] : [link];
    }
    default:
      return [];
  }
}

/** The places one command of the line writes, in the folder it runs in. */
function stepWrites(program: string, operands: readonly string[], folder: string | null): string[] {
  if (program === "git") {
    return gitCalls(operands).flatMap((call) => {
      if (!changesCheckout(call)) return [];
      const where = gitFolder(call, folder);
      return where === null ? [] : [where];
    });
  }
  return inFolder(folder, writtenWords(program, operands));
}

/** The places the commands of `command` write, read one way (`reading`); nested commands too. */
function inspect(command: string, cwd: string | null, reading: Reading, depth = 0): string[] {
  const found: string[] = [];
  let folder = cwd;
  const { dialect, joinLines } = reading;
  // A quote left open is read blind: more pieces, so nothing hides inside it.
  for (const step of shellSteps(command, { blindWhenOpen: true, dialect, joinLines })) {
    const words = wordsOf(step.text, dialect);
    found.push(...inFolder(folder, redirectionTargets(words)));
    const invocation = invocationOf(words);
    if (invocation === undefined) continue;
    const { args, program } = invocation;
    const operands = withoutRedirections(args);
    found.push(...stepWrites(program, operands, folder));
    if (CHANGE_DIR.has(program)) folder = movedTo(program, folder, operands);
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
 * The absolute paths `command` writes, each once, when run in `cwd` (null: a folder the caller
 * does not know, so only absolute paths count). The line is read every way it may run
 * (`readingsOf`), as the git guard reads it.
 */
export function writeTargets(command: string, cwd: string | null, dialect?: Dialect): string[] {
  return [
    ...new Set(readingsOf(command, dialect).flatMap((reading) => inspect(command, cwd, reading))),
  ];
}
