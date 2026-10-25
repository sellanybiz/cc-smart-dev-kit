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
  shellSteps,
  withoutRedirections,
  wordsOf,
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

/** The kind `call` runs, the largest when several match (`vitest --coverage`), or null. */
function kindOfCall(
  call: ToolCall,
  kinds: Kinds,
  scriptOnly = false,
): { name: string; gb: number } | null {
  let best: { name: string; gb: number } | null = null;
  for (const [name, kind] of Object.entries(kinds)) {
    const heavy = (kind.match ?? []).some(
      (rule) =>
        ruleMatches(rule, call, scriptOnly) &&
        // A program that only prints (`tsc --version`) is not heavy; a script is a script.
        ("script" in rule || !printsOnly(kind, call.args)),
    );
    if (heavy && (best === null || kind.gb > best.gb)) best = { name, gb: kind.gb };
  }
  return best;
}

function inspect(
  command: string,
  kinds: Kinds,
  dialect: Dialect,
  depth: number,
  run: Run,
): { name: string; gb: number }[] {
  const found: { name: string; gb: number }[] = [];
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
 * The heavy-job kind a Bash command runs, or null. When it runs several (`tsc && next
 * build`), the one that reserves the most, so a hook that wraps the whole line reserves
 * enough for its largest step. `source` says where the line runs and how to read a folder's
 * `package.json`; without it, a package manager's word is the tool, as before.
 */
export function classifyHeavyCommand(
  bashCommand: string,
  kinds: Kinds,
  source?: ScriptSource,
): string | null {
  let best: { name: string; gb: number } | null = null;
  for (const kind of inspect(bashCommand, kinds, "bash", 0, runOf(source))) {
    if (best === null || kind.gb > best.gb) best = kind;
  }
  return best?.name ?? null;
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
): { name: string; gb: number }[] | null {
  const found: { name: string; gb: number }[] = [];
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

/**
 * The heavy-job kind to queue a Bash line under, or null when the line must run raw. A line
 * is queued only when every command in it is heavy, a `cd`, or an assignment: Claude Code
 * matches a person's own Bash rules (`deny`, `ask`) against the words of the command it runs
 * and does not look inside `bash -c '…'`, so wrapping a line that also runs `rm` would hide
 * that `rm` from a `Bash(rm:*)` deny rule (proved on 2.1.308, `docs/claude-code-contract.md`).
 * Several heavy commands give the one that reserves the most, like `classifyHeavyCommand`.
 * `source` says where the line runs, so a package manager's script name is read as a script
 * (§ `classifyHeavyCommand`).
 */
export function classifyRoutableLine(
  bashCommand: string,
  kinds: Kinds,
  source?: ScriptSource,
): string | null {
  const found = routableKinds(bashCommand, kinds, "bash", 0, runOf(source));
  if (found === null) return null;
  let best: { name: string; gb: number } | null = null;
  for (const kind of found) {
    if (best === null || kind.gb > best.gb) best = kind;
  }
  return best?.name ?? null;
}
