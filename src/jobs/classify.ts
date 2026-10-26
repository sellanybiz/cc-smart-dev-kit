/**
 * Which heavy-job kind does a Bash command run, if any? `classifyHeavyCommand` reads the
 * command with the one shell reader the guards use too (`src/shell/command.ts`), so a tool
 * named inside quotes, a quoted here-doc, a comment or an `echo` is text, not a run, and a
 * tool a substitution, a here-doc fed to `sh` or a pipe into `sh` runs is a run.
 *
 * It finds the tool behind the usual runners: `bunx`, `bun x`, `bun run`, `bun <name>`,
 * `npx`, `npm exec`, `npm run`, `pnpm`, `yarn`, a `node_modules/.bin/` path, `node <script
 * path>`, the wrappers the shell reader steps over (`time -p`, `timeout`, `nice`, `env -i`,
 * `sudo -u x`, `xargs`, …, with their options), and `bash -c "…"`. A `package.json` script is
 * matched only by a kind's `{ "script": … }` rule: when the name is a script of the folder the
 * line runs in, a tool rule never matches it, so a project whose `tsc` script wraps a type
 * check is not queued twice. The classifier learns that through an injected reader
 * (`ScriptSource`, `package-scripts.ts`); it reads no file itself.
 *
 * Pure: no file, no environment — the reader is the caller's, and it is asked at most once per
 * folder in a run. A later hook routes what it finds through `job run`.
 */

import { isAbsolute, join, normalize } from "node:path";
import {
  CHANGE_DIR,
  type Dialect,
  invocationOf,
  isAssignmentOnly,
  isRunnerProgram,
  MAX_NESTING,
  nestedCommand,
  nestedDialect,
  programName,
  redirectionTargets,
  type ShellStep,
  shellSteps,
  withoutRedirections,
  wordsOf,
  wordsWithFill,
} from "../shell/command";
import type { KindSpec, Kinds, MatchRule } from "./kinds";

/** What a command really runs: a program (by name) and its arguments. */
export interface ToolCall {
  /** The program's name: no folder, no `.exe`, no `@version`, a script path's base name. */
  name: string;
  args: string[];
  /** Set when the word may name a `package.json` script (`bun run <name>`, `yarn <name>`). */
  script?: string;
}

/**
 * The `scripts` names of a folder's `package.json`, or null when there is none to read (no
 * file, or one the reader cannot use). Injected, so the classifier stays pure; the real one is
 * `packageScripts` (`package-scripts.ts`).
 */
export type ScriptsOf = (folder: string) => ReadonlySet<string> | null;

/** Where a line runs, and how a package manager's script name is looked up there. */
export interface ScriptSource {
  /** The folder the line starts in: the Bash tool's own folder (after a `cd`, the one it moves to). */
  folder: string;
  /** Reads a folder's `scripts` names. Called at most once per folder in a run. */
  scriptsIn: ScriptsOf;
}

/** What one classification run knows: the folder each command runs in, and one read per folder. */
interface Run {
  /** Undefined: no reader was handed in, and every name is the tool, as before. */
  source: ScriptSource | undefined;
  /** The folder the command being read runs in; null when the line moves somewhere unknown. */
  folder: string | null;
  /** Per folder: its `scripts` names, or null when it has no `package.json` to read. */
  cache: Map<string, ReadonlySet<string> | null>;
}

/** The state a top-level classification starts with. */
function runOf(source: ScriptSource | undefined): Run {
  return { source, folder: source?.folder ?? null, cache: new Map() };
}

/**
 * The `scripts` names of the folder the line is in, or null when nothing can say: no reader,
 * no folder (the line moved somewhere unknown), or no `package.json` there. Null keeps the
 * classifier's old answer — the word is the tool — which is also the safe one for a project
 * whose file is broken: it is treated as one with no file, never as one with no scripts.
 */
function scriptsAt(run: Run): ReadonlySet<string> | null {
  if (run.source === undefined || run.folder === null) return null;
  const folder = run.folder;
  if (!run.cache.has(folder)) {
    let found: ReadonlySet<string> | null = null;
    try {
      found = run.source.scriptsIn(folder);
    } catch {
      found = null; // A reader that throws is no package.json: the tool, as before.
    }
    run.cache.set(folder, found);
  }
  return run.cache.get(folder) ?? null;
}

/**
 * True when the word is a script of the folder the line runs in: then only a kind's
 * `{ "script": … }` rule can match it, and no tool rule does. False when it is no script
 * there, and the package manager runs `node_modules/.bin/<name>`, so a tool rule matches as
 * before. Undefined when nothing says (no reader, no folder, no file): the tool, as before.
 */
function scriptOnly(call: ToolCall, run: Run): boolean | undefined {
  // An empty name (`npm test`) is no tool name: no tool rule could match it anyway, so the
  // folder is not read for it.
  if (call.script === undefined || call.name === "") return undefined;
  const scripts = scriptsAt(run);
  return scripts === null ? undefined : scripts.has(call.script);
}

/** `cd`'s own options, which name no folder: `-L`, `-P`, `-e`, `-@` and the end of options. */
const CD_OPTIONS = new Set(["-L", "-P", "-e", "-@", "--"]);

/** A word the shell works out when it runs (`$DIR`, `~/x`, a glob): it names no folder here. */
const COMPUTED_FOLDER = /[$`*?[\]{}~]/;

/** The first word of `cd` that is no option: the folder it moves to, when it is written out. */
function folderWord(args: readonly string[]): string | undefined {
  let index = 0;
  while (CD_OPTIONS.has(args[index] ?? "")) index++;
  return args[index];
}

/**
 * The folder a change-dir command moves the rest of the line to; null when the line does not
 * name it: `cd` alone (`$HOME`), `cd -`, a folder a variable or a glob gives, or a folder stack
 * (`popd`, and `pushd` with no word). A `cd` is tracked; the other dialects' spellings are
 * not, because the queue route reads Bash lines only.
 */
function folderAfter(
  program: string,
  args: readonly string[],
  folder: string | null,
): string | null {
  if (folder === null) return null;
  if (program !== "cd" && program !== "chdir" && program !== "pushd") return null;
  const target = folderWord(args);
  if (target === undefined || target === "-" || COMPUTED_FOLDER.test(target)) return null;
  return isAbsolute(target) ? normalize(target) : normalize(join(folder, target));
}

/** Options whose value is the next word, per runner: so the value is not the program. */
const BUN_VALUED = ["--config", "--cwd", "--env-file", "--filter", "--preload", "-c", "-F", "-r"];
const NPX_VALUED = ["--package", "-p", "--call", "-c", "--workspace", "-w"];
const PNPM_VALUED = ["--filter", "-F", "--dir", "-C", "--workspace-root"];
/** `node` options that take the next word (a module, or code): it is not the script. */
const NODE_VALUED = [
  "--conditions",
  "--eval",
  "--import",
  "--input-type",
  "--loader",
  "--print",
  "--require",
  "-C",
  "-e",
  "-p",
  "-r",
];

/** Each tool's own options that take the next word, so a value is never read as a `sub`. */
const TOOL_VALUED: Readonly<Record<string, readonly string[]>> = {
  docker: [
    "--config",
    "--context",
    "--host",
    "--log-level",
    "--tlscacert",
    "--tlscert",
    "--tlskey",
    "-c",
    "-H",
    "-l",
    // buildx and compose, read after their own word
    "--builder",
    "--ansi",
    "--env-file",
    "--file",
    "--parallel",
    "--profile",
    "--progress",
    "--project-directory",
    "--project-name",
    "-f",
    "-p",
  ],
  "docker-compose": [
    "--ansi",
    "--env-file",
    "--file",
    "--parallel",
    "--profile",
    "--progress",
    "--project-directory",
    "--project-name",
    "-f",
    "-p",
  ],
  podman: ["--connection", "--url", "--root", "--runroot", "--log-level"],
};

/** Bun's own commands: `bun <one of these>` is never a script or a package's program. */
const BUN_COMMANDS = new Set([
  "add",
  "build",
  "create",
  "exec",
  "i",
  "init",
  "install",
  "link",
  "outdated",
  "patch",
  "pm",
  "publish",
  "remove",
  "repl",
  "rm",
  "test",
  "unlink",
  "update",
  "upgrade",
]);

/** The index of the first word from `from` that is no option (a valued one skips its value). */
function firstWord(args: readonly string[], from: number, valued: readonly string[]): number {
  let index = from;
  while (index < args.length && (args[index] ?? "").startsWith("-")) {
    index += valued.includes(args[index] ?? "") ? 2 : 1;
  }
  return Math.min(index, args.length);
}

/**
 * `./node_modules/.bin/vitest`, `vitest@latest`, `vitest.cmd` give `vitest`. A PATH to a
 * script also loses its `.mjs` / `.cjs` / `.js` (`node_modules/vitest/vitest.mjs` gives
 * `vitest`); a bare word keeps it, and so does a scoped package name (`@scope/next.js`).
 */
export function toolName(word: string): string {
  const isPath = /[\\/]/.test(word) && !/^@[^\\/]+\/[^\\/]+$/.test(word);
  const base = (word.split(/[\\/]/).pop() ?? word)
    .toLowerCase()
    .replace(/\.(cmd|exe|ps1|bat)$/, "");
  return (isPath ? base.replace(/\.(mjs|cjs|js)$/, "") : base).replace(/(?<=.)@.*$/, "");
}

/** A word that may name a script (`bun run x`) or a program: both, unless it is a path. */
function scriptOrTool(word: string, args: string[]): ToolCall {
  return /[\\/]/.test(word)
    ? { name: toolName(word), args }
    : { name: toolName(word), args, script: word };
}

/**
 * The program a command really runs, behind the runners in the header. The wrappers before a
 * program (`timeout`, `nice`, `env`, …) are already stepped over by `invocationOf`.
 */
export function toolOf(program: string, args: string[], depth = 0): ToolCall | undefined {
  if (depth > 4) return undefined;
  const at = (valued: readonly string[], from = 0) => firstWord(args, from, valued);
  switch (program) {
    case "bunx":
    case "npx": {
      const index = at(program === "npx" ? NPX_VALUED : NPX_VALUED.slice(0, 2));
      const name = args[index];
      return name === undefined ? undefined : { name: toolName(name), args: args.slice(index + 1) };
    }
    case "bun": {
      const index = at(BUN_VALUED);
      const sub = args[index];
      if (sub === undefined) return undefined;
      if (sub === "x") return toolOf("bunx", args.slice(index + 1), depth + 1);
      if (sub === "run") {
        const nameAt = firstWord(args, index + 1, BUN_VALUED);
        const name = args[nameAt];
        return name === undefined ? undefined : scriptOrTool(name, args.slice(nameAt + 1));
      }
      if (BUN_COMMANDS.has(sub)) return undefined;
      return scriptOrTool(sub, args.slice(index + 1));
    }
    case "npm": {
      const index = at([]);
      const sub = args[index];
      const rest = args.slice(index + 1);
      if (sub === "exec" || sub === "x") return toolOf("npx", rest, depth + 1);
      if (sub === "test" || sub === "t") return { name: "", args: rest, script: "test" };
      if (sub === "run" || sub === "run-script") {
        const nameAt = firstWord(rest, 0, []);
        const name = rest[nameAt];
        if (name === undefined) return undefined;
        return { name: "", args: rest.slice(nameAt + 1), script: name };
      }
      return undefined;
    }
    case "pnpm":
    case "yarn": {
      const index = at(PNPM_VALUED);
      const sub = args[index];
      if (sub === undefined) return undefined;
      const rest = args.slice(index + 1);
      if (sub === "exec" || sub === "dlx") return toolOf("npx", rest, depth + 1);
      if (sub === "test" || sub === "t") return { name: "", args: rest, script: "test" };
      if (sub === "run" || sub === "run-script") {
        const nameAt = firstWord(rest, 0, []);
        const name = rest[nameAt];
        return name === undefined ? undefined : scriptOrTool(name, rest.slice(nameAt + 1));
      }
      return scriptOrTool(sub, rest);
    }
    case "node": {
      // `node node_modules/vitest/vitest.mjs run` runs the tool through its script path.
      const index = at(NODE_VALUED);
      const script = args[index];
      if (script !== undefined && /[\\/]/.test(script)) {
        return { name: toolName(script), args: args.slice(index + 1) };
      }
      return undefined;
    }
    default:
      return { name: program, args };
  }
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

/** True when `args` start, options skipped, with the words of `sub`, in order. */
function startsWithSub(args: readonly string[], sub: readonly string[], valued: readonly string[]) {
  let from = 0;
  for (const word of sub) {
    const index = firstWord(args, from, valued);
    if (args[index] !== word) return false;
    from = index + 1;
  }
  return true;
}

/** A run that only prints and stops: every argument is a print-only option. */
function printsOnly(kind: KindSpec, args: readonly string[]): boolean {
  const printOnly = new Set((kind.printOnly ?? []).map((flag) => flag.toLowerCase()));
  return (
    printOnly.size > 0 && args.length > 0 && args.every((arg) => printOnly.has(arg.toLowerCase()))
  );
}

/**
 * Does `rule` match what the command runs? `scriptOnly`: the word is a `package.json` script
 * of its folder, so a tool rule never matches it — only a script rule can.
 */
export function ruleMatches(rule: MatchRule, call: ToolCall, scriptOnly = false): boolean {
  if ("script" in rule) return call.script === rule.script;
  if (scriptOnly) return false;
  if (call.name !== rule.tool) return false;
  const valued = [...(TOOL_VALUED[rule.tool] ?? []), ...(rule.valued ?? [])];
  if (rule.sub !== undefined && !startsWithSub(call.args, rule.sub, valued)) return false;
  if (rule.flags !== undefined && !rule.flags.every((flag) => hasFlag(call.args, flag))) {
    return false;
  }
  const text = rule.argIncludes?.toLowerCase();
  return text === undefined || call.args.some((arg) => arg.toLowerCase().includes(text));
}

/**
 * The kind `call` runs, or null. When several match (`vitest --coverage` is a test run and a
 * coverage run), the first one listed wins: the kinds are listed with the specific one first
 * (`DEFAULT_KINDS`), and a project's own kinds come after the defaults.
 */
function kindOfCall(call: ToolCall, kinds: Kinds, scriptOnly = false): string | null {
  for (const [name, kind] of Object.entries(kinds)) {
    const heavy = (kind.match ?? []).some(
      (rule) =>
        ruleMatches(rule, call, scriptOnly) &&
        // A program that only prints (`tsc --version`) is not heavy; a script is a script.
        ("script" in rule || !printsOnly(kind, call.args)),
    );
    if (heavy) return name;
  }
  return null;
}

function inspect(
  command: string,
  kinds: Kinds,
  dialect: Dialect,
  depth: number,
  run: Run,
): string[] {
  const found: string[] = [];
  // A quote left open is read blind: more pieces, so nothing hides inside it.
  const steps = shellSteps(command, { blindWhenOpen: true, dialect, joinLines: true });
  for (const step of steps) {
    const invocation = invocationOf(wordsOf(step.text, dialect));
    if (invocation === undefined) continue;
    const { program, args } = invocation;
    // A redirection (`> out.txt`) is the shell's, never the tool's argument.
    const plain = withoutRedirections(args);
    // A `cd` moves the rest of the line: the script lookup reads the folder it moves to.
    if (CHANGE_DIR.has(program)) {
      run.folder = folderAfter(program, plain, run.folder);
      continue;
    }
    const call = toolOf(program, plain);
    const kind =
      call === undefined ? null : kindOfCall(call, kinds, scriptOnly(call, run) === true);
    if (kind !== null) found.push(kind);
    const inner = nestedCommand(program, args, step.pipedFrom);
    if (inner !== undefined && depth < MAX_NESTING) {
      // A shell of its own starts in this folder, and its own `cd` stays inside it.
      found.push(...inspect(inner, kinds, nestedDialect(program), depth + 1, { ...run }));
    }
  }
  return found;
}

/**
 * The heavy-job kind a shell command runs, or null. When it runs several (`tsc && next
 * build`), the first one the line runs: the queue counts jobs and a kind has no size, so the
 * kind only names the job. `source` says where the line runs and how to read a folder's
 * `package.json`; without it, a package manager's word is the tool, as before. `dialect` is the
 * shell that reads the line: Bash, or the PowerShell tool's (`job-route` refuses a heavy
 * PowerShell line and names the Bash tool instead).
 */
export function classifyHeavyCommand(
  command: string,
  kinds: Kinds,
  source?: ScriptSource,
  dialect: Dialect = "bash",
): string | null {
  return inspect(command, kinds, dialect, 0, runOf(source))[0] ?? null;
}

/**
 * The tool and its own arguments behind a `job run` command (`bunx tsc --noEmit` gives
 * `tsc`, `--noEmit`), so the reservation reads the tool's arguments, not the runner's.
 * Falls back to the command as it is.
 */
export function toolCallOfArgv(argv: readonly [string, ...string[]]): ToolCall {
  const invocation = invocationOf([...argv]);
  if (invocation === undefined) return { name: argv[0], args: argv.slice(1) };
  return (
    toolOf(invocation.program, invocation.args) ?? {
      name: invocation.program,
      args: invocation.args,
    }
  );
}

/** Reads a filter's own arguments: true when that run of it only reads and prints. */
type FilterCheck = (args: readonly string[]) => boolean;

/** A filter with no form that writes a file or runs a program. */
const READS_ONLY: FilterCheck = () => true;

/** A word that is an option, not `-` alone (which names standard input or output). */
const isOption = (arg: string) => arg.startsWith("-") && arg !== "-";

/** A cluster of short options (`-uo`), not a long one (`--output`). */
const isShortCluster = (arg: string) => /^-[^-]/.test(arg);

/** `cat` with no file: it only passes the pipe on. */
function catReadsStdin(args: readonly string[]): boolean {
  return args.every((arg) => arg === "-" || isOption(arg));
}

/** `tee` with no file, or only `/dev/null`: it writes nothing a person keeps. */
function teeWritesNoFile(args: readonly string[]): boolean {
  return args.every((arg) => isOption(arg) || arg === "/dev/null");
}

/** `sort` without `-o`/`--output` (it writes a file) or `--compress-program` (it runs one). */
function sortReadsOnly(args: readonly string[]): boolean {
  // GNU takes a long option by any unique start, so the shortest unique starts are what is
  // refused: `--o` is `--output` (`--ou`, `--out=x`), and `--co` is `--compress-program` (no
  // other option of sort starts with it).
  return !args.some(
    (arg) =>
      arg.startsWith("--o") || arg.startsWith("--co") || (isShortCluster(arg) && arg.includes("o")),
  );
}

/** `uniq` with one input file at most: a second file is where it writes. */
function uniqReadsOnly(args: readonly string[]): boolean {
  let files = 0;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "-f" || arg === "-s" || arg === "-w")
      index++; // the value is a number
    else if (!isOption(arg)) files++;
  }
  return files <= 1;
}

/**
 * `rg` without `--pre` (it runs a program on each file), `-z` (it runs decompressors) or
 * `--hostname-bin` (it runs a program for its links' host name).
 */
function rgReadsOnly(args: readonly string[]): boolean {
  return !args.some(
    (arg) =>
      arg.startsWith("--pre") ||
      arg.startsWith("--hostname-bin") ||
      arg === "--search-zip" ||
      (isShortCluster(arg) && arg.includes("z")),
  );
}

/** `sed`'s options that only change how it reads and prints: `-n`, `-E`, `-r`, `-s`, `-u`, `-z`. */
const SED_SHORT = /^-[nErsuz]+$/;
const SED_LONG = new Set([
  "--debug",
  "--null-data",
  "--posix",
  "--quiet",
  "--regexp-extended",
  "--sandbox",
  "--separate",
  "--silent",
  "--unbuffered",
]);
/** The commands of a sed script that only read, print, move between lines or stop. */
const SED_PLAIN_COMMANDS = "=DdGgHhNnPpQqxz}";

/**
 * The end of a regular expression or a replacement that starts at `from` and ends at the
 * delimiter `delimiter` (a backslash escapes it), or -1 when it never ends.
 */
function sedPartEnd(script: string, from: number, delimiter: string): number {
  let at = from;
  while (at < script.length) {
    const char = script.charAt(at);
    if (char === "\\") at += 2;
    else if (char === delimiter) return at;
    else if (char === "\n") return -1;
    else at++;
  }
  return -1;
}

/**
 * True when every bracket expression in a regular expression `part` is plain: `[`, an optional
 * `^`, then one or more characters up to the first `]`, none of them `[`, `\`, a line end or
 * the delimiter. GNU sed ends a regular expression at the first delimiter, and BSD (macOS) sed
 * reads a delimiter inside `[...]` as a plain character, so `s/[/]/;/w x/p` has a `w` flag on
 * BSD only. With plain brackets both read the same script. An escaped `\[` is no bracket.
 */
function sedBracketsPlain(part: string, delimiter: string): boolean {
  let at = 0;
  while (at < part.length) {
    const char = part.charAt(at);
    if (char === "\\") {
      at += 2;
      continue;
    }
    if (char !== "[") {
      at++;
      continue;
    }
    let inside = at + 1;
    if (part.charAt(inside) === "^") inside++;
    const first = inside;
    while (inside < part.length && part.charAt(inside) !== "]") {
      const one = part.charAt(inside);
      if (one === "[" || one === "\\" || one === "\n" || one === delimiter) return false;
      inside++;
    }
    if (inside === first || inside >= part.length) return false; // `[]…]`, `[^]…]`, or never closed
    at = inside + 1;
  }
  return true;
}

/** One sed address (`12`, `$`, `/re/`, `1~2`, `+3`), read from `at`: where it ends, or -1. */
function sedAddressEnd(script: string, at: number): number {
  const number = /^(?:\d+(?:~\d+)?|\$|[+~]\d+)/.exec(script.slice(at));
  if (number !== null) return at + number[0].length;
  if (script.charAt(at) !== "/") return at;
  const end = sedPartEnd(script, at + 1, "/");
  if (end === -1 || !sedBracketsPlain(script.slice(at + 1, end), "/")) return -1;
  return end + 1;
}

/**
 * True when a sed script only reads and prints: each command is an address or two and one of
 * `SED_PLAIN_COMMANDS`, `s/…/…/` with no `w` or `e` flag, or `y/…/…/`. Anything it cannot read
 * this way — `w` (writes a file), `e` (runs a program), `r`, `a`, a label, a branch, a bracket
 * expression two seds read differently (`sedBracketsPlain`) — is not a filter: a script that
 * cannot be read safely is never called read-only.
 */
export function sedScriptReadsOnly(script: string): boolean {
  let at = 0;
  const skip = (chars: RegExp) => {
    while (at < script.length && chars.test(script.charAt(at))) at++;
  };
  while (true) {
    skip(/[\s;]/);
    if (at >= script.length) return true;
    at = sedAddressEnd(script, at);
    if (at === -1) return false;
    if (script.charAt(at) === ",") {
      const end = sedAddressEnd(script, at + 1);
      if (end === -1 || end === at + 1) return false; // `1,p`: the second address is missing
      at = end;
    }
    skip(/[ \t]/);
    if (script.charAt(at) === "!") at++;
    skip(/[ \t]/);
    const command = script.charAt(at);
    at++;
    if (command === "s" || command === "y") {
      const delimiter = script.charAt(at);
      if (delimiter === "" || /[\s\\]/.test(delimiter)) return false;
      const middle = sedPartEnd(script, at + 1, delimiter);
      if (middle === -1) return false;
      if (!sedBracketsPlain(script.slice(at + 1, middle), delimiter)) return false;
      const end = sedPartEnd(script, middle + 1, delimiter);
      if (end === -1) return false;
      at = end + 1;
      if (command === "s") {
        const flags = /^[gpiImM0-9]*/.exec(script.slice(at))?.[0] ?? "";
        at += flags.length;
      }
    } else if (command === "{") {
      continue; // a group: its first command may follow at once (`/x/{p;q}`)
    } else if (command !== "" && SED_PLAIN_COMMANDS.includes(command)) {
      // `q5` / `Q5`: an exit code.
      if (command === "q" || command === "Q") skip(/\d/);
    } else {
      return false;
    }
    skip(/[ \t]/);
    const next = script.charAt(at);
    if (next !== "" && next !== ";" && next !== "\n" && next !== "}") return false;
  }
}

/**
 * `sed` with no `-i` (it edits the file in place) and no `-f` (a script in a file), whose
 * scripts `sedScriptReadsOnly` can read. The words after the script are files it reads.
 */
function sedReadsOnly(args: readonly string[]): boolean {
  const scripts: string[] = [];
  const operands: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    const expression = /^-[nErsuz]*e(.*)$/s.exec(arg);
    if (expression !== null) {
      const value = expression[1] === "" ? args[++index] : expression[1];
      if (value === undefined) return false;
      scripts.push(value);
    } else if (arg === "--expression") {
      const value = args[++index];
      if (value === undefined) return false;
      scripts.push(value);
    } else if (arg.startsWith("--expression=")) {
      scripts.push(arg.slice("--expression=".length));
    } else if (/^--line-length=\d+$/.test(arg)) {
      // How long an `l` line may be: it changes no file.
    } else if (arg === "-l" && /^\d+$/.test(args[index + 1] ?? "")) {
      index++;
    } else if (SED_SHORT.test(arg) || SED_LONG.has(arg)) {
      // An option that only changes how it reads and prints.
    } else if (isOption(arg)) {
      return false; // `-i`, `--in-place`, `-f`, and every option this reader does not know
    } else {
      operands.push(arg);
    }
  }
  if (scripts.length === 0) {
    const script = operands.shift();
    if (script === undefined) return false;
    scripts.push(script);
  }
  return scripts.every(sedScriptReadsOnly);
}

/**
 * `awk` whose program has no `>` (a file it writes, or a comparison: both refused), no `|` (a
 * program it runs), no `system` and no `@` (gawk's includes and indirect calls); with no `-f`
 * (a program in a file) and no option but `-F` and `-v`.
 */
function awkReadsOnly(args: readonly string[]): boolean {
  let program: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      program = args[index + 1];
      break;
    }
    if (arg === "-F" || arg === "-v") index++;
    else if (/^-[Fv]./s.test(arg)) continue;
    else if (isOption(arg)) return false;
    else {
      program = arg;
      break;
    }
  }
  return program !== undefined && !/[>|@]|system/.test(program);
}

/**
 * The read-only filters a routed line may pipe its heavy command into, by program name, each
 * with the reader of its own arguments. **The one list**: a line `tsc --noEmit 2>&1 | tail -20`
 * is queued with the filter kept outside the queue's command, so the person's own Bash rules
 * still see it. Short on purpose — each one prints what it reads and changes nothing:
 *
 * - `less` and `more` are not here: they wait for a person at the keyboard.
 * - `tee` is here only with no file (or `/dev/null`): with one, it writes it, and a person's
 *   `Bash(tee:*)` rule must see that line as written.
 * - `sed` and `awk` are here only when their script can be read and does not write or run
 *   anything (`sedScriptReadsOnly`, `awkReadsOnly`); `sort` without `-o` or
 *   `--compress-program`; `uniq` with no output file; `rg` without `--pre`, `-z` or
 *   `--hostname-bin`; `cat` with no file.
 */
export const READ_ONLY_FILTERS: Readonly<Record<string, FilterCheck>> = {
  awk: awkReadsOnly,
  cat: catReadsStdin,
  cut: READS_ONLY,
  egrep: READS_ONLY,
  fgrep: READS_ONLY,
  gawk: awkReadsOnly,
  grep: READS_ONLY,
  head: READS_ONLY,
  mawk: awkReadsOnly,
  nawk: awkReadsOnly,
  rg: rgReadsOnly,
  sed: sedReadsOnly,
  sort: sortReadsOnly,
  tail: READS_ONLY,
  tee: teeWritesNoFile,
  tr: READS_ONLY,
  uniq: uniqReadsOnly,
  wc: READS_ONLY,
};

/**
 * True when one step of a line is a read-only filter fed by the pipe: piped from the step
 * before it (`a | b`, never `a || b`), the program first (no wrapper, no assignment, no `!`),
 * nothing the shell fills in, no file its output is sent to, and arguments its reader in
 * `READ_ONLY_FILTERS` accepts.
 */
function isReadOnlyFilter(step: ShellStep): boolean {
  if (step.pipedFrom === null || step.pipedFrom.trim() === "" || step.expanded) return false;
  const filled = wordsWithFill(step.text, "bash");
  if (filled.length === 0 || filled.some((word) => word.filled)) return false;
  const words = filled.map((word) => word.text);
  const program = programName(words[0] ?? "");
  const check = READ_ONLY_FILTERS[program];
  if (check === undefined) return false;
  const invocation = invocationOf(words);
  if (
    invocation === undefined ||
    invocation.computed ||
    invocation.prefix.length > 0 ||
    invocation.program !== program
  ) {
    return false;
  }
  if (redirectionTargets(words).some((target) => target !== "/dev/null")) return false;
  return check(withoutRedirections(invocation.args));
}

/**
 * The line cut where its trailing read-only filters start: `tsc 2>&1 | tail -20` gives
 * `tsc 2>&1` and `| tail -20`. Null when the line ends in no filter, or when the cut cannot be
 * found in the text exactly as the reader split it (a comment, a joined line, a substitution):
 * then nothing is cut.
 */
function splitAtFilters(line: string): { heavy: string; filters: string } | null {
  const steps = shellSteps(line, { blindWhenOpen: true, dialect: "bash", joinLines: true });
  let end = line.length;
  let found = 0;
  for (let index = steps.length - 1; index > 0; index--) {
    const step = steps[index];
    if (step === undefined || !isReadOnlyFilter(step)) break;
    const start = end - step.text.length;
    if (start < 1 || line.slice(start, end) !== step.text) return null;
    const before = line.charAt(start - 2);
    if (line.charAt(start - 1) !== "|" || before === "|" || before === ">") return null;
    end = start - 1;
    found++;
  }
  return found === 0 ? null : { heavy: line.slice(0, end).trimEnd(), filters: line.slice(end) };
}

/**
 * True when the part before the filters runs one command whose output they read, after
 * nothing but `cd`s and assignments: so `cd app && tsc | tail` cuts to `cd app && tsc` and
 * `| tail`, and the filter still reads exactly what it read before. `tsc && vitest | tail` is
 * not one (the filter read only the test run's output), nor is `! tsc | tail` (the `!` turned
 * the whole pipeline's exit code around).
 */
function feedsFiltersAlone(heavy: string): boolean {
  const commands = shellSteps(heavy, { blindWhenOpen: true, dialect: "bash", joinLines: true })
    .map((step) => wordsOf(step.text))
    .filter((words) => words.length > 0 && !isAssignmentOnly(words));
  const last = commands.at(-1);
  if (last === undefined || last[0] === "!") return false;
  const changesDir = (words: readonly string[]) => {
    const invocation = invocationOf(words);
    return invocation !== undefined && CHANGE_DIR.has(invocation.program);
  };
  return !changesDir(last) && commands.slice(0, -1).every(changesDir);
}

/**
 * The kinds a line runs, when every command in it is heavy, a `cd`, or an assignment: null
 * as soon as one is anything else. The inner command of a shell (`bash -c "…"`) is read the
 * same way, so `bash -c "tsc && rm x"` is no pure line.
 */
function routableKinds(
  command: string,
  kinds: Kinds,
  dialect: Dialect,
  depth: number,
  run: Run,
): string[] | null {
  const found: string[] = [];
  const steps = shellSteps(command, { blindWhenOpen: true, dialect, joinLines: true });
  for (const step of steps) {
    const words = wordsOf(step.text, dialect);
    // The reader leaves an empty step where an operator (`&&`, `;`) sits.
    if (words.length === 0 || isAssignmentOnly(words)) continue;
    const invocation = invocationOf(words);
    if (invocation === undefined) return null;
    const { program, args } = invocation;
    const plain = withoutRedirections(args);
    // A `cd` is allowed on a routed line, and moves the rest of the line's folder.
    if (CHANGE_DIR.has(program)) {
      run.folder = folderAfter(program, plain, run.folder);
      continue;
    }
    // A runner (`find`, `watch`, `su`, `parallel`) does work of its own beside the command it
    // runs — a delete, a user switch, an endless repeat — and the person's `Bash(find:*)` rules
    // only see the words of the line that runs: never a pure step (`classifyHeavyCommand` still
    // reads through it, for the hook's questions).
    if (isRunnerProgram(program)) return null;
    const inner = nestedCommand(program, args, step.pipedFrom);
    if (inner !== undefined) {
      // A shell or wrapper that runs a line: that line must be pure too.
      if (depth >= MAX_NESTING) return null;
      const nested = routableKinds(inner, kinds, nestedDialect(program), depth + 1, {
        ...run,
      });
      if (nested === null) return null;
      found.push(...nested);
      continue;
    }
    const call = toolOf(program, plain);
    const kind =
      call === undefined ? null : kindOfCall(call, kinds, scriptOnly(call, run) === true);
    if (kind === null) return null;
    found.push(kind);
  }
  return found;
}

/** A Bash line the queue can take: its kind, the part that is queued, and the filters after it. */
export interface RoutableLine {
  kind: string;
  /** What goes into the queue: the whole line, or the part before its filters. */
  heavy: string;
  /** The read-only filters the heavy part's output is piped into, from the first `|`; "" when none. */
  filters: string;
}

/**
 * The Bash line to queue, cut where it must be, or null when the line must run raw. A line
 * is queued only when every command in it is heavy, a `cd`, or an assignment: Claude Code
 * matches a person's own Bash rules (`deny`, `ask`) against the words of the command it runs
 * and does not look inside `bash -c '…'`, so wrapping a line that also runs `rm` would hide
 * that `rm` from a `Bash(rm:*)` deny rule (proved on 2.1.308, `docs/claude-code-contract.md`).
 *
 * The one exception is a pipe into read-only filters at the end (`READ_ONLY_FILTERS`):
 * `tsc --noEmit 2>&1 | tail -20` is queued as `tsc --noEmit 2>&1`, and `| tail -20` stays
 * outside the queue's command, where the person's rules still see it. A filter before the heavy
 * command (`cat x | tsc`) is no exception, and neither is a filter inside a shell string.
 *
 * Several heavy commands give the first one the line runs, like `classifyHeavyCommand`.
 * `source` says where the line runs, so a package manager's script name is read as a script
 * (§ `classifyHeavyCommand`).
 */
export function routableLine(
  bashCommand: string,
  kinds: Kinds,
  source?: ScriptSource,
): RoutableLine | null {
  const split = splitAtFilters(bashCommand.trim());
  if (split !== null && feedsFiltersAlone(split.heavy)) {
    const kind = routableKinds(split.heavy, kinds, "bash", 0, runOf(source))?.[0];
    return kind === undefined ? null : { filters: split.filters, heavy: split.heavy, kind };
  }
  const kind = routableKinds(bashCommand, kinds, "bash", 0, runOf(source))?.[0];
  return kind === undefined ? null : { filters: "", heavy: bashCommand, kind };
}

/** `routableLine`'s kind alone: the heavy-job kind to queue a Bash line under, or null. */
export function classifyRoutableLine(
  bashCommand: string,
  kinds: Kinds,
  source?: ScriptSource,
): string | null {
  return routableLine(bashCommand, kinds, source)?.kind ?? null;
}
