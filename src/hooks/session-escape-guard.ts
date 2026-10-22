/**
 * The session-escape guard: PreToolUse on Bash, PowerShell, Edit, Write and NotebookEdit.
 *
 * A session must not be able to loosen the limits the person set for it. Four ways a session
 * could go around them, and one answer for each:
 *
 *   1. `cc-smart-dev-kit workflow review-done` records a review by hand. A session never records
 *      its own review: the review-record hook does it when a review agent returns. **Denied.**
 *   2. Any other `cc-smart-dev-kit` command run with `CLAUDECODE` unset, emptied or overwritten
 *      (`env -u CLAUDECODE …`, `CLAUDECODE= …`, `unset CLAUDECODE; …`, `env -i`, `sudo`).
 *      Claude Code sets `CLAUDECODE` for the commands it runs, and the commands that change
 *      this machine's settings (the workflow gate, the portal, updates) refuse to run while it
 *      is set — a courtesy, not a lock (`src/workflow/commands.ts`). This guard is the lock.
 *      **Denied.**
 *   3. A Bash command that reaches the portal's port on this machine. The portal has no sign-in
 *      of its own (its Settings page can switch the review gate off), so a session with `curl`
 *      could use it. **Asks.**
 *   4. An Edit or Write to the kit's own settings: any `.claude/cc-smart-dev-kit.json` (the
 *      project's gate and `ownHooks`), the kit's settings folder (`workflow.json`,
 *      `gateway.json`), its state folder (the review record) and its installed plugin folder
 *      (the guards and hooks Claude Code runs). **Asks.** The merge guard reads
 *      its gate from the base branch, but the person's own `workflow.json` and the record are
 *      read from these files.
 *
 * **A crew session is never asked** (D36): every ask above is a denial that names the step —
 * the kit's own limits are the person's, and the portal is no place for a crew session — and
 * the question goes to its lead with `crew report --question` (`CREW_QUESTION_STEP`). The
 * person's own session keeps each ask exactly as before.
 *
 * **Machine-wide**, like `agent-guard`: it runs with or without `cc-smart-dev-kit.json`, in a
 * folder outside git, and when the project's file is broken; its answer never depends on the
 * project. And `ownHooks` cannot switch it off (`HookSpec.alwaysOn`): the project file is one
 * of the things it guards, so a session could otherwise list the guard there first.
 *
 * It asks rather than denies where the person may mean it (the portal, an edit of a settings
 * file or of the installed plugin); it denies what is never right from inside a session (1 and
 * 2). A same-user process set on getting past it can (a script file, a path built at run time):
 * it stops mistakes and shortcuts, like the review gate it protects (`docs/design.md` § The
 * session-escape guard).
 *
 * A shell line that **writes** into those files asks too, like an Edit would: a redirect (`>`,
 * `>>`, `>|`), `tee`, `sed -i` / `perl -i`, `cp` / `mv` / `install` / `ln` onto the path, `dd of=`,
 * and PowerShell's `Set-Content`, `Add-Content`, `Out-File`, `Tee-Object`, `Copy-Item` and
 * `Move-Item`. A read (`cat workflow.json`) passes. Each target is resolved as written (the
 * `~`, and a relative path against the folder the line is in, `cd` followed) and as a real
 * path, and each protected folder is compared both as written and by its real path, so a link
 * cannot hide it. A target the line works out when it runs (`> $FILE`) cannot be resolved: it
 * asks only when the line also names one of the protected files or folders by text
 * (`cc-smart-dev-kit.json`, `~/.config/cc-smart-dev-kit`, …), and passes otherwise.
 *
 * A program the line **computes** (`$KIT`, `$(which cc-smart-dev-kit)`) cannot be named: when
 * the line also names the kit command, the guard asks rather than stay silent. `Start-Process`
 * is read by its `-FilePath`/`-ArgumentList`, and `-UseNewEnvironment` is a fresh environment.
 *
 * Not read: a script file's content (`env -u CLAUDECODE sh run.sh`), a port named at run time
 * (`curl localhost:$PORT`), a portal started on another port, a write by a program this file
 * does not know (`python -c "open(…, 'w')"`, `rsync`, `truncate`), and a computed target in a
 * line that never names the protected files. Reading the shell line is
 * `src/shell/command.ts`'s job; this file adds no lexer of its own.
 */

import { dirname, isAbsolute, posix, relative, resolve, win32 } from "node:path";
import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { CREW_QUESTION_STEP } from "../crew/session";
import { isInside } from "../path-compare";
import { DEFAULT_PORTAL_PORT } from "../ports";
import {
  type Dialect,
  dialectOfTool,
  invocationOf,
  isAssignmentOnly,
  isShort,
  isWrapper,
  MAX_NESTING,
  nestedCommand,
  nestedDialect,
  programName,
  type Reading,
  readingsOf,
  redirectionTargets,
  shellSteps,
  shortFlags,
  withoutRedirections,
  wordsOf,
} from "../shell/command";
import { realPath } from "./git";
import {
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";

/** The shell tools, and the tools that edit a file. */
export const ESCAPE_SHELL_TOOLS: readonly string[] = ["Bash", "PowerShell"];
export const ESCAPE_EDIT_TOOLS: readonly string[] = ["Edit", "Write", "NotebookEdit"];

/** The variable Claude Code sets for the commands it runs. */
const CLAUDECODE = "CLAUDECODE";

/** The kit's per-project file, as a path ends: `.claude/cc-smart-dev-kit.json`. */
const PROJECT_FILE = `${COMMAND}.json`;
const PROJECT_FOLDER = ".claude";

// ---- The shell: what a Bash or PowerShell line runs ------------------------------------

/** Why `CLAUDECODE` is not what Claude Code set it to. Each one finishes "CLAUDECODE …". */
const OVERWRITTEN = "is overwritten (`CLAUDECODE=…`)";
const UNSET = "is unset";
const CLEARED = "is gone: the whole environment is cleared (`env -i`)";
const RESET = "is gone: the program starts the command with a fresh environment";

/**
 * Programs that start a command with an environment of their own, whatever the shell had
 * (`sudo` resets it; `su`, `runuser`, `ssh` and `systemd-run` start a new login or manager).
 * `invocationOf` steps over `sudo` and `doas` as wrappers, so those two are read from the
 * words before the program; the rest are read as programs, and every argument that holds a
 * space is read as a command line (`ssh host 'cc-smart-dev-kit …'`).
 */
const RESETTERS: ReadonlySet<string> = new Set([
  "doas",
  "runuser",
  "ssh",
  "su",
  "sudo",
  "systemd-run",
]);

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
function isKitWord(word: string): boolean {
  return programName(word) === COMMAND || KIT_BUNDLE.test(word);
}

/**
 * The arguments of the kit command a program runs, or null when it runs none: the program
 * is the kit command, or has it among its arguments (`bun …/dist/cli.js workflow …`,
 * `find . -exec cc-smart-dev-kit … \;`) and is not one that only reads its arguments.
 */
function kitArguments(program: string, args: readonly string[]): string[] | null {
  if (programName(program) === COMMAND) return [...args];
  if (INERT.has(program)) return null;
  const at = args.findIndex(isKitWord);
  return at === -1 ? null : args.slice(at + 1);
}

const ASSIGNS_CLAUDECODE = new RegExp(`^${CLAUDECODE}=`, "i");

/** `env`'s options that take a value, so `-u NAME` is not read as a command. */
const ENV_VALUED_LONG = ["--chdir", "--split-string"];

/** Why the words before the program (`invocationOf`'s `prefix`) drop CLAUDECODE, or null. */
function prefixDrop(prefix: readonly string[], program: string): string | null {
  // `env - cmd` (the old spelling of `env -i`): the reader takes no lone `-` for an option, so
  // it arrives as the program.
  if (program === "-" && programName(prefix.at(-1) ?? "") === "env") return CLEARED;
  if (prefix.some((word) => ASSIGNS_CLAUDECODE.test(word))) return OVERWRITTEN;
  if (prefix.some((word) => RESETTERS.has(programName(word)))) return RESET;
  // `Start-Process … -UseNewEnvironment` (the reader puts both words in the prefix).
  if (prefix.some((word, at) => isFreshEnvironment(prefix[at - 1] ?? "", word))) return RESET;
  for (let at = 0; at < prefix.length; at++) {
    if (programName(prefix[at] ?? "") !== "env") continue;
    for (let index = at + 1; index < prefix.length; index++) {
      const word = prefix[index] ?? "";
      if (word === "--") break;
      if (word === "-") return CLEARED;
      if (word.startsWith("--")) {
        const [name = "", inline] = word.split("=", 2);
        if (name === "--ignore-environment") return CLEARED;
        if (name === "--unset") {
          if ((inline ?? prefix[++index]) === CLAUDECODE) return UNSET;
        } else if (ENV_VALUED_LONG.includes(name) && inline === undefined) index++;
        continue;
      }
      if (!isShort(word)) {
        if (/^\w+=/.test(word)) continue; // `env A=1 B=2 cmd`: assignments come after the options
        break;
      }
      const { flags, wantsNext } = shortFlags(word, "uCS");
      if (flags.includes("i")) return CLEARED;
      if (flags.endsWith("u")) {
        const name = wantsNext ? prefix[++index] : word.slice(flags.length + 1);
        if (name === CLAUDECODE) return UNSET;
      } else if (wantsNext) index++;
    }
  }
  return null;
}

/**
 * True for `Start-Process`'s `-UseNewEnvironment`, after the reader put `Start-Process` before
 * it: PowerShell takes any prefix of a parameter name, and only that parameter starts with
 * `u`.
 */
function isFreshEnvironment(before: string, parameter: string): boolean {
  if (programName(before) !== "start-process") return false;
  const given = /^-([a-z]+)$/i.exec(parameter)?.[1]?.toLowerCase() ?? "";
  return given !== "" && "usenewenvironment".startsWith(given);
}

/** PowerShell: a write to the `CLAUDECODE` environment variable. */
const POWERSHELL_DROPS: readonly RegExp[] = [
  new RegExp(String.raw`\$\{?env:${CLAUDECODE}\}?\s*=(?!=)`, "i"),
  new RegExp(
    String.raw`\b(?:clear-item|cli|new-item|ni|remove-item|ri|rm|del|erase|set-item|si)\b[^\n;|]*\benv:\\?${CLAUDECODE}\b`,
    "i",
  ),
  new RegExp(String.raw`\bSetEnvironmentVariable\s*\(\s*['"]${CLAUDECODE}['"]`, "i"),
];

/**
 * Why a PowerShell line writes the variable, read from its whole text: PowerShell's lexer
 * cuts a line at every brace and parenthesis (`${env:CLAUDECODE} = ''` and
 * `SetEnvironmentVariable(…)` come in pieces), so no single step shows the write. It counts
 * for the whole line, the commands before the write included: a rare extra deny, never a miss.
 */
function powershellDrop(line: string): string | null {
  return POWERSHELL_DROPS.some((pattern) => pattern.test(line)) ? OVERWRITTEN : null;
}

/**
 * Why this step changes CLAUDECODE for **every command after it** in the line (`unset
 * CLAUDECODE`, `export CLAUDECODE=`, a step that is only `CLAUDECODE=`), or null. A change
 * that lasts only for one command is `prefixDrop`'s.
 */
function persistentDrop(
  words: readonly string[],
  program: string | undefined,
  args: readonly string[],
): string | null {
  if (program === undefined) {
    // Nothing runs: the step is only assignments (`CLAUDECODE=`), and they change the shell.
    return words.some((word) => ASSIGNS_CLAUDECODE.test(word)) ? OVERWRITTEN : null;
  }
  const names = args.filter((arg) => !arg.startsWith("-") || ASSIGNS_CLAUDECODE.test(arg));
  if (program === "unset") return names.includes(CLAUDECODE) ? UNSET : null;
  if (["declare", "export", "local", "readonly", "set", "typeset"].includes(program)) {
    if (args.some((arg) => ASSIGNS_CLAUDECODE.test(arg))) return OVERWRITTEN;
    // `export -n NAME` and `declare +x NAME` keep the variable but stop exporting it.
    const stopsExporting = args.includes("-n") || args.includes("+x");
    return stopsExporting && names.includes(CLAUDECODE) ? UNSET : null;
  }
  return null;
}

/** What one line turned up: what to deny, and what to ask the person about. */
interface Findings {
  denials: Set<string>;
  asks: Set<string>;
}

/** What every step of the line is judged against. */
interface ShellContext {
  paths: CliPaths;
  /** The input's `cwd`, or null; where a relative target is looked for, besides a `cd`'s. */
  cwd: string | null;
  /** The platform whose paths the line names (the hook's own; a test may pass another). */
  platform: NodeJS.Platform;
  /** The whole command text, for the check that reads text rather than commands. */
  text: string;
}

/** `node:path`'s Windows or POSIX rules, for the platform whose paths the line names. */
function pathRules(platform: NodeJS.Platform): typeof posix {
  return platform === "win32" ? win32 : posix;
}

/**
 * A path a Bash line names, as the platform reads it. Claude Code's Bash tool is Git Bash on
 * Windows, where MSYS2 maps the drive `C:` to `/c`: a line that writes `/c/Users/…` writes
 * `C:/Users/…`. Read as it is, `/c/…` would look like a folder named `c` on whatever drive
 * the line runs on, and a write into the kit's own files would go unseen. PowerShell runs
 * natively, so its `/c/…` is no drive and is left alone.
 */
export function shellTargetPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
  dialect: Dialect = "bash",
): string {
  if (platform !== "win32" || dialect !== "bash") return path;
  const drive = /^\/+([A-Za-z])\//.exec(path);
  return drive === null ? path : `${drive[1]?.toUpperCase()}:/${path.slice(drive[0].length)}`;
}

const REVIEW_DONE_DENIAL = `\`${COMMAND} workflow review-done\` records a review by hand, for the person in their own terminal. A session never records its own review: the review-record hook records it when a review agent (the \`reviewAgents\` setting) returns. Run the review agent on the change instead; if it did and nothing was recorded, tell the person.`;

function droppedDenial(why: string): string {
  return `This runs a ${COMMAND} command with CLAUDECODE removed: it ${why}. Claude Code sets CLAUDECODE for the commands it runs, and the commands that change this machine's settings (the workflow gate, the portal, updates) refuse to run while it is set, because they are for the person in their own terminal. Dropping it to get past that is not allowed. If the person wants the command run, they run it themselves.`;
}

/** What one kit command asks for, judged. `dropped`: why CLAUDECODE is not set for it, or null. */
function judgeKitCommand(
  kitArgs: readonly string[],
  dropped: string | null,
  found: Findings,
): void {
  const operands = withoutRedirections(kitArgs);
  if (operands[0] === "workflow" && operands[1] === "review-done") {
    found.denials.add(REVIEW_DONE_DENIAL);
  }
  if (dropped !== null) found.denials.add(droppedDenial(dropped));
}

// ---- Shell writes into the kit's own files ---------------------------------------------

/** Programs that write the file(s) among their arguments in place: `tee`, `Set-Content`, … */
const WRITES_ITS_FILES: ReadonlySet<string> = new Set([
  "ac",
  "add-content",
  "out-file",
  "sc",
  "set-content",
  "tee",
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

/** Programs that change the folder the next commands of the line run in. */
const CHANGES_FOLDER: ReadonlySet<string> = new Set([
  "cd",
  "chdir",
  "popd",
  "push-location",
  "pushd",
  "set-location",
  "sl",
]);

function isString(value: string | null | undefined): value is string {
  return typeof value === "string";
}

/** The words of a path that are not a path yet: a variable, a command, a glob, `%VAR%`. */
const COMPUTED_PATH = /[$`*?[\]]|%\w+%/;

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

/** `cp -t DIR`, `cp -tDIR`, `cp --target-directory=DIR`, `cp --target-directory DIR`. */
function targetDirectories(args: readonly string[]): string[] {
  const found: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "-t" || arg === "--target-directory") found.push(args[++index] ?? "");
    else if (arg.startsWith("--target-directory=")) found.push(arg.slice(19));
    else if (/^-t./.test(arg) && !arg.startsWith("--")) found.push(arg.slice(2));
  }
  return found.filter((one) => one !== "");
}

/**
 * The paths one command of the line writes, as the line spells them: its redirections, and the
 * files a program that writes in place is given. Nothing for a program that only reads.
 * `words` are all the step's words (a redirection may stand before the program).
 */
function writtenPaths(
  words: readonly string[],
  invocation: ReturnType<typeof invocationOf>,
): string[] {
  const written = redirectionTargets(words);
  if (invocation === undefined) return written;
  const { program } = invocation;
  const args = withoutRedirections(invocation.args);
  const operands = args.filter((arg) => !arg.startsWith("-"));
  if (WRITES_ITS_FILES.has(program)) written.push(...operands);
  else if (program === "dd")
    written.push(...args.filter((arg) => arg.startsWith("of=")).map((arg) => arg.slice(3)));
  else if (program === "sed" || program === "perl") {
    // `-i`, `-i.bak`, `-pi`, `-ni`, `--in-place`: the files are edited in place.
    if (args.some((arg) => arg.startsWith("--in-place") || /^-[a-z]*i/.test(arg))) {
      written.push(...operands);
    }
  } else if (COPIES.has(program)) {
    const given = [...parameterValues(args, ["destination"]), ...targetDirectories(args)];
    written.push(...(given.length > 0 ? given : operands.slice(-1)));
    if (MOVES.has(program)) written.push(...operands);
  }
  return written;
}

/** The folder a `cd` (or the like) moves the line to; null when it cannot be told. */
function movedTo(
  invocation: NonNullable<ReturnType<typeof invocationOf>>,
  folder: string | null,
  ctx: ShellContext,
  dialect: Dialect,
): string | null {
  const to = withoutRedirections(invocation.args).find((arg) => !arg.startsWith("-"));
  if (to === undefined) return invocation.program === "cd" ? ctx.paths.home : folder;
  const path = shellTargetPath(expanded(to, ctx.paths.home), ctx.platform, dialect);
  if (COMPUTED_PATH.test(path) || path === "-") return null;
  const rules = pathRules(ctx.platform);
  return rules.isAbsolute(path)
    ? rules.resolve(path)
    : folder === null
      ? null
      : rules.resolve(folder, path);
}

/** The places in the text of a command that name the protected files, normalised for `includes`. */
function protectedNeedles(paths: CliPaths): string[] {
  const settings = dirname(paths.workflowConfigFile);
  const needles = [PROJECT_FILE, settings, paths.stateDir, paths.pluginCacheDir];
  for (const folder of [settings, paths.stateDir, paths.pluginCacheDir]) {
    const underHome = relative(paths.home, folder);
    if (!underHome.startsWith("..") && !isAbsolute(underHome)) needles.push(underHome);
    // The real path behind a linked folder (`~/.config` → somewhere else) names the same files.
    needles.push(realPath(folder));
  }
  return needles.map((needle) => needle.replace(/\\/g, "/").toLowerCase());
}

/** True when the text of the command names a protected file or folder. */
function namesProtected(text: string, paths: CliPaths): boolean {
  const lower = text.replace(/\\/g, "/").toLowerCase();
  return protectedNeedles(paths).some((needle) => lower.includes(needle));
}

/**
 * The words before a kit word that sits inside another program's arguments, read as a prefix
 * (`find . -exec env -u CLAUDECODE <kit> …`): from the first wrapper word among the
 * program's own words to the kit word. `env -u CLAUDECODE` and the like are there, so
 * `prefixDrop` sees the same drop a kit command at the start of the line would show.
 */
function innerKitPrefix(program: string, operands: readonly string[]): string[] {
  const words = [program, ...operands];
  const atKit = words.findIndex(isKitWord);
  if (atKit === -1) return [];
  // A wrapper runs what follows it; an assignment before the kit word (`CLAUDECODE= …`) is a
  // drop of its own.
  const atStart = words
    .slice(0, atKit)
    .findIndex((word) => isWrapper(word) || isAssignmentOnly([word]));
  return atStart === -1 ? [] : words.slice(atStart, atKit);
}

/** The question when the line names the kit command but its program is worked out at run time. */
const COMPUTED_KIT_ASK = `This command runs a program it works out when it runs, and its words name the ${COMMAND} command, so the guard cannot tell whether it runs it. Write the command out in full if you meant it.`;

/** The kit command as a word of a line's text (`K=${COMMAND}; $(which $K) …` names it too). */
const KIT_WORD = new RegExp(
  `(^|[^\\w.-])${COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w.-]|$)`,
  "i",
);

/** Why a question about a kit file is asked at all: the same sentence for an Edit and a command. */
const SETTINGS_TAIL =
  "These files hold the limits the kit's guards enforce, so a session that changes them changes its own limits. Allow it only if you asked for this change.";

/** The reason for a question about changing a kit file: one wording for an Edit and a command. */
function settingsQuestion(what: string, file: string, action: string): string {
  return `${action} ${what}: ${file}. ${SETTINGS_TAIL}`;
}

/** Asks about each protected file the paths `raw` write into, once each. */
function judgeWrites(
  raw: readonly string[],
  folder: string | null,
  ctx: ShellContext,
  found: Findings,
  dialect: Dialect,
): void {
  const { cwd, paths } = ctx;
  const rules = pathRules(ctx.platform);
  let computed: string | null = null;
  for (const target of raw) {
    const path = shellTargetPath(expanded(target, paths.home), ctx.platform, dialect);
    if (COMPUTED_PATH.test(path)) {
      computed ??= target;
      continue;
    }
    // A relative path is looked for where the line has moved to, and where it began: a `cd` in a
    // subshell is not told apart from one that lasts.
    if (!rules.isAbsolute(path) && folder === null) computed ??= target;
    const bases = rules.isAbsolute(path) ? [""] : [...new Set([folder, cwd, "/"].filter(isString))];
    const files = bases.flatMap((base) => {
      const written = rules.resolve(base, path);
      return [written, realPath(written)];
    });
    for (const file of new Set(files)) {
      const what = kitFileKind(file, paths);
      if (what !== null) {
        found.asks.add(settingsQuestion(what, file, "This command writes into"));
        break;
      }
    }
  }
  if (computed !== null && namesProtected(ctx.text, paths)) {
    found.asks.add(
      `This command writes to a path it works out when it runs (${computed}), and it names the kit's own settings. ${SETTINGS_TAIL}`,
    );
  }
}

/**
 * Reads one line one way (`reading`), command by command, in order: a change to CLAUDECODE
 * (`persistentDrop`) holds for the commands after it, one on a single command
 * (`prefixDrop`) for that command and the line it runs. `start`: why CLAUDECODE is already
 * gone when this line begins (a line a wrapper runs). Returns the same for what follows.
 * `folder`: where the line runs (null when a `cd` made it unknown); each `cd` moves it.
 */
function readLine(
  line: string,
  reading: Reading,
  start: string | null,
  folder: string | null,
  depth: number,
  found: Findings,
  ctx: ShellContext,
): string | null {
  const { dialect, joinLines } = reading;
  let dropped = start ?? (dialect === "powershell" ? powershellDrop(line) : null);
  let where = folder;
  // A quote left open is read blind: more pieces, so nothing hides inside it.
  for (const step of shellSteps(line, { blindWhenOpen: true, dialect, joinLines })) {
    const words = wordsOf(step.text, dialect);
    const invocation = invocationOf(words);
    const writes = writtenPaths(words, invocation);
    if (writes.length > 0) judgeWrites(writes, where, ctx, found, dialect);
    if (invocation !== undefined && CHANGES_FOLDER.has(invocation.program)) {
      where = invocation.program === "popd" ? null : movedTo(invocation, where, ctx, dialect);
    }
    const later = persistentDrop(
      words,
      invocation?.program,
      invocation === undefined ? [] : withoutRedirections(invocation.args),
    );
    if (invocation !== undefined) {
      const { args, prefix, program } = invocation;
      const operands = withoutRedirections(args);
      const resets = RESETTERS.has(program) ? RESET : null;
      const here = dropped ?? prefixDrop(prefix, program) ?? resets;
      const kit = kitArguments(program, operands);
      if (kit !== null) {
        // The kit word may sit inside another program's arguments (`find … -exec env -u
        // CLAUDECODE <kit>`): the words before it hold the drop too.
        const inside = prefixDrop(innerKitPrefix(program, operands), program);
        judgeKitCommand(kit, here ?? inside, found);
      }
      // A computed program cannot be named: if the line names the kit command, ask.
      if (invocation.computed && KIT_WORD.test(ctx.text)) found.asks.add(COMPUTED_KIT_ASK);
      if (depth < MAX_NESTING) {
        const nested = nestedCommand(program, args, step.pipedFrom);
        if (nested !== undefined) {
          for (const inner of readingsOf(nested, nestedDialect(program))) {
            const after = readLine(nested, inner, here, where, depth + 1, found, ctx);
            // `eval` runs in this shell: what it unset stays unset. A `bash -c` does not.
            if (program === "eval") dropped = after ?? dropped;
          }
        }
        if (resets !== null) {
          // `ssh host 'cmd'`, `su -c 'cmd'`: an argument that holds a space is a command line.
          for (const operand of operands.filter((one) => /\s/.test(one))) {
            for (const inner of readingsOf(operand, "bash")) {
              readLine(operand, inner, here, where, depth + 1, found, ctx);
            }
          }
        }
      }
    }
    dropped = later ?? dropped;
  }
  return dropped;
}

/**
 * The portal's address in a command's text: this machine under any spelling a client takes
 * (`localhost`, `127.0.0.1` and its short forms, `[::1]`, `0.0.0.0`, the decimal and hex IPv4
 * forms), then the portal's port, with a `:`, a `/` (`/dev/tcp/127.0.0.1/20150`), a space (`nc
 * localhost 20150`) or the quotes of a script (`('localhost', 20150)`) between them.
 */
const LOOPBACK = String.raw`(?:[\w-]+\.)?localhost|127(?:\.\d{1,3}){0,3}|0\.0\.0\.0|0x7f[\da-f.x]*|2130706433|\[?::1?\]?|\[?::ffff:[\d.]+\]?`;
const PORTAL_ADDRESS = new RegExp(
  String.raw`(?<![\w.:-])(?:${LOOPBACK})[\s:/,'")\]]{1,8}${DEFAULT_PORTAL_PORT}(?!\d)`,
  "i",
);

const PORTAL_QUESTION = `This command reaches the portal's port (${DEFAULT_PORTAL_PORT}) on this machine. The portal has no sign-in of its own: its pages change the gateway, the safety judge, updates and the workflow settings, the review gate included. It is for you, in your own browser. Allow this only if you asked for it.`;

/**
 * Why a crew session's write into the kit's own files is denied (D36): the limits are the
 * person's, nobody is at the machine to answer the guard's question, and the step puts the
 * question to the lead. It covers an edit and a shell write alike — the project's
 * `cc-smart-dev-kit.json`, the kit's settings, its state folder and its installed plugin.
 */
export const CREW_KIT_REFUSAL =
  "A crew session never changes the kit's own limits (the project's cc-smart-dev-kit.json, the " +
  "kit's settings, its state folder, or its installed plugin): the limits are the person's, and " +
  "the guard asks before such a write. " +
  CREW_QUESTION_STEP;

/** Why a crew session's call into the portal is denied: it has no business with it (D36). */
export const CREW_PORTAL_REFUSAL =
  "A crew session has no business with the portal: its pages change the gateway, the safety " +
  "judge, updates and the workflow settings, and the portal is for the person, in their own " +
  "browser. " +
  CREW_QUESTION_STEP;

/** The text of a command line, for the checks that read the whole text rather than its commands. */
function commandOf(input: HookInput): string {
  return stringField(toolInput(input).command) ?? "";
}

/** The answer for a Bash or PowerShell call. `crew`: a crew session, which is never asked. */
function judgeShell(
  input: HookInput,
  paths: CliPaths,
  platform: NodeJS.Platform,
  crew: boolean,
): HookResult {
  const command = commandOf(input);
  if (command === "") return SILENT;
  const found: Findings = { denials: new Set(), asks: new Set() };
  const ctx: ShellContext = {
    paths,
    cwd: stringField(input.cwd),
    platform,
    text: command,
  };
  for (const reading of readingsOf(command, dialectOfTool(input.tool_name))) {
    readLine(command, reading, null, ctx.cwd, 0, found, ctx);
  }
  if (found.denials.size > 0) return toolDecision("deny", [...found.denials].join("\n"));
  // The text, not the commands: a client in a script (`python3 <<EOF … urlopen(…)`) is no
  // word of the line. A message that only mentions the address asks too — the cheaper mistake.
  const portal = PORTAL_ADDRESS.test(command);
  if (crew) {
    // A crew session is never asked: each question is a denial, and the portal is one no
    // crew session has any business with.
    if (portal) return toolDecision("deny", CREW_PORTAL_REFUSAL);
    return found.asks.size > 0 ? toolDecision("deny", CREW_KIT_REFUSAL) : SILENT;
  }
  if (portal) found.asks.add(PORTAL_QUESTION);
  return found.asks.size > 0 ? toolDecision("ask", [...found.asks].join("\n")) : SILENT;
}

// ---- The edit tools: which file an edit is about ---------------------------------------

/** What a kit file is, in the question's words. */
const PROJECT_FILE_WHAT = `the project's ${COMMAND} settings (the workflow gate, which hooks run)`;
const SETTINGS_WHAT = "the kit's own settings folder (the person's workflow and gateway settings)";
const STATE_WHAT = "the kit's own state folder (the review record, the ask log)";
const PLUGIN_WHAT =
  "the kit's own installed plugin folder (the guards and hooks Claude Code runs from it)";

/** `~` and `~/…` mean the home folder, as the shell and most tools read them. */
function expanded(path: string, home: string): string {
  return /^~(?=$|[\\/])/.test(path) ? `${home}${path.slice(1)}` : path;
}

/**
 * Every spelling of a protected folder a target may match: the path as written and its real
 * path. A home folder whose `~/.config` is a link writes the same file by the real path, and
 * the written one must not be the only one compared.
 */
function folderForms(folder: string): string[] {
  return [folder, realPath(folder)];
}

/**
 * What kit file `path` is, or null. Names compare without case on every host (a case-blind
 * disk makes `CC-Smart-Dev-Kit.JSON` the same file, and an extra question costs less than a
 * miss). `path` is absolute.
 */
function kitFileKind(path: string, paths: CliPaths): string | null {
  const parts = path.split(/[\\/]/);
  const name = parts.at(-1) ?? "";
  if (
    name.toLowerCase() === PROJECT_FILE.toLowerCase() &&
    (parts.at(-2) ?? "").toLowerCase() === PROJECT_FOLDER
  ) {
    return PROJECT_FILE_WHAT;
  }
  const settingsFolders = [paths.workflowConfigFile, paths.gatewayConfigFile].map(dirname);
  const inside = (folder: string) => folderForms(folder).some((form) => isInside(path, form, true));
  if (settingsFolders.some(inside)) return SETTINGS_WHAT;
  if (inside(paths.stateDir)) return STATE_WHAT;
  // Claude Code runs the guards and hooks from its copy of this plugin: a write into it
  // changes them, so it asks. The person may mean it (a hand edit before an update), so never
  // a deny.
  return inside(paths.pluginCacheDir) ? PLUGIN_WHAT : null;
}

/**
 * The file an Edit, Write or NotebookEdit is about, written as the call writes it and as a
 * real path (a link on the way to it must not hide what it is): the tool follows a link, so a
 * file named `notes.txt` that links to `workflow.json` changes `workflow.json`.
 */
function editedPaths(input: HookInput, cwd: string | null, home: string): string[] {
  const fields = toolInput(input);
  const given = stringField(fields.file_path) ?? stringField(fields.notebook_path);
  if (given === null) return [];
  const path = expanded(given, home);
  const written = isAbsolute(path) ? resolve(path) : resolve(cwd ?? "/", path);
  return [...new Set([written, realPath(written)])];
}

/** The answer for an Edit, Write or NotebookEdit call. `crew`: a crew session, never asked. */
function judgeEdit(input: HookInput, paths: CliPaths, crew: boolean): HookResult {
  for (const file of editedPaths(input, stringField(input.cwd), paths.home)) {
    const what = kitFileKind(file, paths);
    if (what !== null) {
      return crew
        ? toolDecision("deny", CREW_KIT_REFUSAL)
        : toolDecision("ask", settingsQuestion(what, file, "This edit changes"));
    }
  }
  return SILENT;
}

// ---- The guard -------------------------------------------------------------------------

/**
 * The guard's answer for one call; silent for a tool it does not judge. `platform` is the
 * machine whose paths a shell line names (the hook's own; a test may pass another, so the
 * Windows forms of a path are proved on Linux too). `crew`: the session is a crew session,
 * which is never asked — every question is a denial naming the step that reaches its lead
 * (D36). The guard is `alwaysOn`, so this one flag in every path it answers through is the
 * whole crew rule; a crew part would judge each call twice.
 */
export function sessionEscapeGuard(
  input: HookInput,
  paths: CliPaths,
  platform: NodeJS.Platform = process.platform,
  crew = false,
): HookResult {
  const tool = stringField(input.tool_name) ?? "";
  if (ESCAPE_SHELL_TOOLS.includes(tool)) return judgeShell(input, paths, platform, crew);
  if (ESCAPE_EDIT_TOOLS.includes(tool)) return judgeEdit(input, paths, crew);
  return SILENT;
}

/** Words a command that concerns this guard holds, whatever else is in it (the crash domain). */
const DOMAIN_TEXT = new RegExp(
  `${COMMAND}|${CLAUDECODE}|${DEFAULT_PORTAL_PORT}|(?:dist|entries)[\\\\/](?:cli|portal)\\.`,
  "i",
);

/**
 * The calls this guard judges, read without the reader (it may be what crashed): every edit,
 * and a shell line that names the kit, CLAUDECODE or the portal's port. A crash asks about
 * exactly these.
 */
export function inEscapeDomain(input: HookInput): boolean {
  const tool = stringField(input.tool_name) ?? "";
  if (ESCAPE_EDIT_TOOLS.includes(tool)) return true;
  return ESCAPE_SHELL_TOOLS.includes(tool) && DOMAIN_TEXT.test(commandOf(input));
}
