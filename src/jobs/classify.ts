/**
 * Which heavy-job kind does a Bash command run, if any, and how heavy is the run?
 * `classifyHeavyCommand` reads the command with the one shell reader the guards use too
 * (`src/shell/command.ts`), so a tool named inside quotes, a quoted here-doc, a comment or an
 * `echo` is text, not a run, and a tool a substitution, a here-doc fed to `sh` or a pipe into
 * `sh` runs is a run.
 *
 * It finds the tool behind the usual runners: `bunx`, `bun x`, `bun run`, `bun test`, `bun
 * <name>`, `npx`, `npm exec`, `npm run`, `pnpm`, `yarn`, a `node_modules/.bin/` path, `node
 * <script path>`, the wrappers the shell reader steps over (`time -p`, `timeout`, `nice`, `env
 * -i`, `cross-env`, `sudo -u x`, `xargs`, …, with their options), and `bash -c "…"`.
 *
 * A `package.json` script is matched by a kind's `{ "script": … }` rule first. A script no rule
 * names is read by its **body**: the commands in it are classified as if the line ran them, in
 * the folder of the `package.json`, with the `pre<name>` and `post<name>` scripts the runner
 * runs beside it. When the name is a script of the folder the line runs in, a tool rule never
 * matches it (the script is read, not the tool of the same name). A line or a script body that
 * already runs `cc-smart-dev-kit job run` (under any spelling of the kit's command, `isJobRun`)
 * is queued already: it is never routed or weighed
 * again, so a project whose `tsc` script wraps the queue is not queued twice. The classifier
 * learns the scripts and the files through injected readers (`ScriptSource`, `WeightSource`,
 * `package-scripts.ts`); it reads no file itself.
 *
 * Four questions, one walk of the line (`scan`):
 * - `classifyHeavyCommand`: the first heavy kind the line runs (any command of it), also inside
 *   a `job run` it already holds.
 * - `classifyUnqueuedHeavy`: the same, but none for a line that already runs `job run`: what
 *   the git hook's question reads.
 * - `routableLine`: the line the route may queue, when **every** command in it is heavy and
 *   none of them is `job run`.
 * - `runWeight`: whether a run is light (it names only existing files, or only prints), heavy
 *   (with its kind) or none (nothing heavy, a watch run that never ends, or already queued).
 *
 * Pure: no file, no environment — the readers are the caller's, and the script reader is asked
 * at most once per folder in a run.
 */

import { isAbsolute, join, normalize } from "node:path";
import {
  CHANGE_DIR,
  type Dialect,
  invocationOf,
  isAssignmentOnly,
  isJobRun,
  isRunnerProgram,
  MAX_NESTING,
  nestedCommand,
  nestedDialect,
  redirectionTargets,
  type ShellStep,
  shellSteps,
  withoutRedirections,
  wordsOf,
  wordsWithFill,
} from "../shell/command";
import { programName } from "../shell/program-name";
import { isPrintOnly, isWatchRun, type Kinds, type MatchRule, namesOnlyFiles } from "./kinds";

/** What a command really runs: a program (by name) and its arguments. */
export interface ToolCall {
  /** The program's name: no folder, no `.exe`, no `@version`, a script path's base name. */
  name: string;
  args: string[];
  /** Set when the word may name a `package.json` script (`bun run <name>`, `yarn <name>`). */
  script?: string;
  /**
   * The folder the package manager was told to run in (`bun --cwd app`, `pnpm -C app`, `npm
   * --prefix app`), as written: relative to the folder the line runs in.
   */
  dir?: string;
}

/**
 * The scripts of a folder's `package.json`: each name with its body. `folder` is the folder of
 * the `package.json` itself — where a script runs — when it is not the folder that was asked
 * (the reader walks up to the nearest file, as the package managers do).
 */
export type ScriptBodies = ReadonlyMap<string, string> & {
  readonly folder?: string;
  /** The project uses Yarn 2 or newer (berry), which runs no `pre` or `post` script of a script. */
  readonly yarnBerry?: boolean;
};

/**
 * The `scripts` of a folder's `package.json`, or null when there is none to read (no file, or
 * one the reader cannot use). Injected, so the classifier stays pure; the real one is
 * `packageScripts` (`package-scripts.ts`).
 */
export type ScriptsOf = (folder: string) => ScriptBodies | null;

/** Where a line runs, and how a package manager's script name is looked up there. */
export interface ScriptSource {
  /** The folder the line starts in: the Bash tool's own folder (after a `cd`, the one it moves to). */
  folder: string;
  /** Reads a folder's `scripts`. Called at most once per folder in a run. */
  scriptsIn: ScriptsOf;
}

/** A `ScriptSource` that can also say whether a word names a file: what `runWeight` needs. */
export interface WeightSource extends ScriptSource {
  /** True when `word` names an existing file, read from `folder` (`fileExistsIn`). */
  isFile: (folder: string, word: string) => boolean;
}

/** What one classification run knows: the folder each command runs in, and one read per folder. */
interface Run {
  /** Undefined: no reader was handed in, and every name is the tool, as before. */
  source: ScriptSource | undefined;
  /** The folder the command being read runs in; null when the line moves somewhere unknown. */
  folder: string | null;
  /** Per folder: its `scripts`, or null when it has no `package.json` to read. */
  cache: Map<string, ScriptBodies | null>;
  /** Inside a script's body: the package manager that ran it, which `$npm_execpath` names. */
  runner: string | undefined;
  /** Inside a one-command script body: the words after the script's name, given to that command. */
  extra: readonly string[] | undefined;
  /** Inside a script's body of several commands: no run in it is a run on named files. */
  compound: boolean;
  /** The (folder, script) pairs being read, so a script that calls itself ends. */
  reading: readonly string[];
  /**
   * With `all`: a run that only prints counts as understood. The route's own walk refuses it (a
   * print-only run is not heavy, so it is never queued); the weight's walk accepts it, since
   * such a run is light and so is a line made of it.
   */
  printOk: boolean;
}

/** The state a top-level classification starts with. */
function runOf(source: ScriptSource | undefined): Run {
  return {
    source,
    folder: source?.folder ?? null,
    cache: new Map(),
    runner: undefined,
    extra: undefined,
    compound: false,
    reading: [],
    printOk: false,
  };
}

/**
 * The scripts of `folder`, or null when nothing can say: no reader, no folder (the line moved
 * somewhere unknown), or no `package.json` there. Null keeps the classifier's old answer — the
 * word is the tool — which is also the safe one for a project whose file is broken: it is
 * treated as one with no file, never as one with no scripts.
 */
function scriptsAt(run: Run, folder: string | null): ScriptBodies | null {
  if (run.source === undefined || folder === null) return null;
  if (!run.cache.has(folder)) {
    let found: ScriptBodies | null = null;
    try {
      found = run.source.scriptsIn(folder);
    } catch {
      found = null; // A reader that throws is no package.json: the tool, as before.
    }
    run.cache.set(folder, found);
  }
  return run.cache.get(folder) ?? null;
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
 * The folder `target` names from `folder`; null when the target is not written out (a variable,
 * a glob, `-`) or `folder` is not known and the target is relative.
 */
function resolveFolder(folder: string | null, target: string | undefined): string | null {
  if (target === undefined || target === "-" || COMPUTED_FOLDER.test(target)) return null;
  if (isAbsolute(target)) return normalize(target);
  return folder === null ? null : normalize(join(folder, target));
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
  return resolveFolder(folder, folderWord(args));
}

/** Options whose value is the next word, per runner: so the value is not the program. */
const BUN_VALUED = ["--config", "--cwd", "--env-file", "--filter", "--preload", "-c", "-F", "-r"];
const NPX_VALUED = ["--package", "-p", "--call", "-c", "--workspace", "-w"];
const NPM_VALUED = ["--prefix", "-C"];
const PNPM_VALUED = ["--filter", "-F", "--dir", "-C", "--workspace-root"];
const YARN_VALUED = [...PNPM_VALUED, "--cwd"];
/** The valued options of each package manager, so a value is never read as the command. */
const RUNNER_VALUED: Readonly<Record<string, readonly string[]>> = {
  bun: BUN_VALUED,
  npm: NPM_VALUED,
  pnpm: PNPM_VALUED,
  yarn: YARN_VALUED,
};

/**
 * The options that tell a package manager which folder to run in, per runner: `bun --cwd`,
 * `pnpm -C` / `--dir`, `npm --prefix` / `-C`, `yarn --cwd` (each one's own documentation).
 */
const RUNNER_FOLDER_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  bun: ["--cwd"],
  npm: ["--prefix", "-C"],
  pnpm: ["-C", "--dir"],
  yarn: ["--cwd"],
};

/** The folder option among `head` (the runner's words before the script or tool name), as written. */
function runnerFolder(program: string, head: readonly string[]): string | undefined {
  const names = RUNNER_FOLDER_OPTIONS[program] ?? [];
  for (let index = 0; index < head.length; index++) {
    const word = head[index] ?? "";
    const equals = word.indexOf("=");
    if (!names.includes(equals === -1 ? word : word.slice(0, equals))) continue;
    return equals === -1 ? head[index + 1] : word.slice(equals + 1);
  }
  return undefined;
}

/** `call` with the folder the runner was told to run in, when it was told. */
function inFolder(call: ToolCall, program: string, head: readonly string[]): ToolCall {
  const dir = runnerFolder(program, head);
  return dir === undefined ? call : { ...call, dir };
}
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

/**
 * Bun's own commands, other than `test`: `bun <one of these>` is never a script or a package's
 * program. `bun test` is Bun's own test runner, a heavy command (`toolOf`).
 */
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
  if (["bun", "npm", "pnpm", "yarn"].includes(program)) {
    const index = at(RUNNER_VALUED[program] ?? []);
    const sub = args[index];
    if (
      (program === "yarn" && sub === undefined) ||
      (sub !== undefined &&
        ["install", "i", "add", ...(program === "npm" ? ["ci"] : [])].includes(sub))
    ) {
      return { name: program, args: sub === undefined ? ["install", ...args] : args.slice(index) };
    }
  }
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
        if (name === undefined) return undefined;
        return inFolder(scriptOrTool(name, args.slice(nameAt + 1)), program, args.slice(0, nameAt));
      }
      // Bun's own test runner, never a script: its options before `test` (`bun --bun test`)
      // stay in the arguments, where the table of `bun test` reads them.
      if (sub === "test") {
        return { name: "bun", args: ["test", ...args.slice(0, index), ...args.slice(index + 1)] };
      }
      if (BUN_COMMANDS.has(sub)) return undefined;
      return inFolder(scriptOrTool(sub, args.slice(index + 1)), program, args.slice(0, index));
    }
    case "npm": {
      const index = at(NPM_VALUED);
      const sub = args[index];
      const rest = args.slice(index + 1);
      if (sub === "exec" || sub === "x") return toolOf("npx", rest, depth + 1);
      if (sub === "test" || sub === "t") {
        return inFolder({ name: "", args: rest, script: "test" }, program, args.slice(0, index));
      }
      if (sub === "run" || sub === "run-script") {
        const nameAt = firstWord(rest, 0, NPM_VALUED);
        const name = rest[nameAt];
        if (name === undefined) return undefined;
        const call = { name: "", args: rest.slice(nameAt + 1), script: name };
        return inFolder(call, program, args.slice(0, index + 1 + nameAt));
      }
      return undefined;
    }
    case "pnpm":
    case "yarn": {
      const index = at(RUNNER_VALUED[program] ?? []);
      const sub = args[index];
      if (sub === undefined) return undefined;
      const rest = args.slice(index + 1);
      if (sub === "exec" || sub === "dlx") return toolOf("npx", rest, depth + 1);
      if (sub === "test" || sub === "t") {
        return inFolder({ name: "", args: rest, script: "test" }, program, args.slice(0, index));
      }
      if (sub === "run" || sub === "run-script") {
        const nameAt = firstWord(rest, 0, []);
        const name = rest[nameAt];
        if (name === undefined) return undefined;
        const call = scriptOrTool(name, rest.slice(nameAt + 1));
        return inFolder(call, program, args.slice(0, index + 1 + nameAt));
      }
      return inFolder(scriptOrTool(sub, rest), program, args.slice(0, index));
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

/** The kind a call matched, and how: by a tool rule (`tool`: its name) or by a script rule. */
interface Hit {
  kind: string;
  /** The tool a tool rule matched, whose own options are read; undefined for a script rule. */
  tool: string | undefined;
  /** The run only prints and stops (`tsc --version`): any one print-only option of its kind. */
  printOnly: boolean;
}

/**
 * The kind `call` runs, or null. When several match (`vitest --coverage` is a test run and a
 * coverage run), the first one listed wins: the kinds are listed with the specific one first
 * (`DEFAULT_KINDS`), and a project's own kinds come after the defaults. A run that only prints
 * is a match too, flagged: a kind of its own that matches it without printing wins over it, and
 * a script is a script, never print-only.
 */
function matchOfCall(call: ToolCall, kinds: Kinds, scriptOnly: boolean): Hit | null {
  let printing: Hit | null = null;
  for (const [name, kind] of Object.entries(kinds)) {
    const rules = (kind.match ?? []).filter((rule) => ruleMatches(rule, call, scriptOnly));
    if (rules.length === 0) continue;
    if (rules.some((rule) => "script" in rule)) {
      return { kind: name, tool: undefined, printOnly: false };
    }
    const hit = { kind: name, tool: call.name, printOnly: isPrintOnly(kind, call.args) };
    if (!hit.printOnly) return hit;
    printing ??= hit;
  }
  return printing;
}

/** One heavy command a line runs, with what the weight of it depends on. */
interface Found extends Hit {
  call: ToolCall;
  /** The folder the command runs in; null when the line moves somewhere unknown. */
  folder: string | null;
  /** The command is one of several in a script's body: its arguments are not all it is given. */
  compound: boolean;
}

/** What one walk of a line finds: its heavy commands, and what else the weight depends on. */
interface Scan {
  found: Found[];
  /** The line sends a command to the background. */
  background: boolean;
  /** The line (or a script it runs) already runs `job run`: it is queued, and must not nest. */
  queued: boolean;
}

const newScan = (): Scan => ({ found: [], background: false, queued: false });

/** A lone `&` (a command sent to the background): not `&&`, `2>&1`, `&>file` or `|&`. */
const LONE_AMPERSAND = /(?<![&|>])&(?![&>])/;

/**
 * True when a line sends a command to the background (`a & b`). The reader gives the commands
 * of the line, not the separators between them, so the text between each two is read here. A
 * command the line does not hold as written (a substitution, a here-doc) cannot be placed, and
 * the answer is then yes: the safe one for the caller, which only asks about several heavy runs.
 */
function sendsToBackground(command: string, steps: readonly ShellStep[]): boolean {
  let at = 0;
  for (const step of steps) {
    // The reader leaves an empty step where an operator (`&&`, `;`) sits.
    if (step.text === "") continue;
    const start = command.indexOf(step.text, at);
    if (start === -1 || LONE_AMPERSAND.test(command.slice(at, start))) return true;
    at = start + step.text.length;
  }
  return LONE_AMPERSAND.test(command.slice(at));
}

/** `$npm_execpath`, `${npm_execpath}`: the package manager that runs a script, as the program. */
const NPM_EXECPATH = /^\$\{?npm_execpath\}?$/;

/** True when the body is one plain command (an assignment alone is no command). */
function isOneCommand(body: string): boolean {
  const steps = shellSteps(body, { blindWhenOpen: true, dialect: "bash", joinLines: true });
  return (
    steps
      .map((step) => wordsOf(step.text))
      .filter((words) => words.length > 0 && !isAssignmentOnly(words)).length === 1
  );
}

/**
 * Reads a script's body (and its `pre` and `post` scripts, which bun, npm, pnpm and yarn classic
 * run beside it; yarn berry does not, and the reader says so: `ScriptBodies.yarnBerry`).
 * `all`: every command in them must be heavy, as on a line. Returns false when that fails, or
 * when the script cannot be read (too deep, or it calls itself).
 */
function expandScript(
  call: ToolCall,
  runner: string,
  bodies: ScriptBodies,
  lookedUpIn: string | null,
  kinds: Kinds,
  depth: number,
  run: Run,
  all: boolean,
  out: Scan,
): boolean {
  if (depth >= MAX_NESTING) return false;
  const name = call.script ?? "";
  const folder = bodies.folder ?? lookedUpIn;
  const hooks = !(runner === "yarn" && bodies.yarnBerry === true);
  const parts = [hooks ? `pre${name}` : "", name, hooks ? `post${name}` : ""].filter((part) =>
    bodies.has(part),
  );
  const main = bodies.get(name) ?? "";
  // Extra arguments reach a body that is one plain command; a body of several is never light.
  const one = parts.length === 1 && isOneCommand(main);
  for (const part of parts) {
    const key = JSON.stringify([folder, part]);
    if (run.reading.includes(key)) {
      if (all) return false;
      continue;
    }
    const inside: Run = {
      ...run,
      folder,
      runner,
      extra: one && part === name ? call.args : undefined,
      compound: run.compound || !one,
      reading: [...run.reading, key],
    };
    if (!scan(bodies.get(part) ?? "", kinds, "bash", depth + 1, inside, all, out) && all) {
      return false;
    }
  }
  return true;
}

/**
 * The arguments a package runner hands to the script, from those written after its name. A
 * runner takes a `--` for itself and drops it, so what follows is the script's own words and
 * the watch rule must see them (`bun run e2e -- --ui` runs `playwright test --ui`):
 * - npm: the first `--`, wherever it stands (`npm run <command> [-- <args>]`, its docs: not
 *   run here). A flag written before it is npm's own, and goes (see below);
 * - Bun: a `--` that comes first (run on Bun 1.4.4: `s -- --ui` gives `--ui`, `s a -- --ui` gives
 *   `a -- --ui`);
 * - Yarn 1 (classic): the first `--`, wherever it stands (run on 1.22.22: `run p a -- --ui` gives
 *   `a --ui`, with the warning "scripts don't require `--`");
 * - Yarn 2+ (berry): a `--` that comes first (run on 3.8.7 and 4.9.2, same as Bun).
 * pnpm passes the `--` on to the script (run on 7, 8, 9 and 10: `run p -- --ui` gives
 * `-- --ui`), so it stays.
 */
function scriptArgs(args: string[], runner: string, bodies: ScriptBodies): string[] {
  const at = args.indexOf("--");
  if (runner === "npm") {
    // npm keeps a flag written before the `--` for itself (`npm run e2e --ui` runs the plain
    // script: "Use `--` to pass `-`-prefixed flags and options which would otherwise be parsed
    // by npm"). Its valued options are not guessed: a value left in is a plain word, and a
    // plain word only makes a run light when it names a file that exists.
    const own = at === -1 ? args : args.slice(0, at);
    const after = at === -1 ? [] : args.slice(at + 1);
    return [...own.filter((word) => word === "-" || !word.startsWith("-")), ...after];
  }
  if (at === -1) return args;
  const anywhere = runner === "yarn" && bodies.yarnBerry !== true;
  const leading = runner === "bun" || (runner === "yarn" && bodies.yarnBerry === true);
  const drops = anywhere || (leading && at === 0);
  return drops ? [...args.slice(0, at), ...args.slice(at + 1)] : args;
}

/**
 * Reads one command's tool call: records the heavy command it is, or reads the script it runs.
 * Returns whether it is heavy (a script: whether its body is, when `all`).
 */
function matchCall(
  asked: ToolCall,
  runner: string,
  kinds: Kinds,
  depth: number,
  run: Run,
  all: boolean,
  out: Scan,
): boolean {
  const lookedUpIn = asked.dir === undefined ? run.folder : resolveFolder(run.folder, asked.dir);
  const bodies = asked.script === undefined ? null : scriptsAt(run, lookedUpIn);
  const isScript = asked.script !== undefined && bodies?.has(asked.script) === true;
  // A script gets its arguments from the runner, which drops its own `--`.
  const call =
    isScript && bodies !== null
      ? { ...asked, args: scriptArgs(asked.args, runner, bodies) }
      : asked;
  // A name the project defines as a script is never a tool: only a script rule can match it.
  const hit = matchOfCall(call, kinds, isScript);
  if (hit !== null) {
    // A run that only prints is not heavy (the weight's walk still understands it: `printOk`).
    if (all && hit.printOnly && !run.printOk) return false;
    // The command runs in the folder the runner was told to use (`pnpm -C app vitest …`); a
    // script rule's arguments go to a script that runs in its package.json's folder.
    const folder = hit.tool === undefined ? (bodies?.folder ?? lookedUpIn) : lookedUpIn;
    out.found.push({ ...hit, call, folder, compound: run.compound });
    return true;
  }
  if (!isScript || bodies === null) return false;
  return expandScript(call, runner, bodies, lookedUpIn, kinds, depth, run, all, out);
}

/**
 * Walks a line, and everything it runs: each command, the line a shell or wrapper runs, and the
 * body of a package script, three levels deep (`MAX_NESTING`). Records the heavy commands it
 * finds in `out`, in order.
 *
 * `all` is the route's rule: **every** command must be heavy, a `cd` or an assignment, and the
 * walk returns false at the first that is not (a print-only run is not heavy, and neither is a
 * runner such as `find` or `watch`: it does work of its own beside the command it runs, and the
 * person's `Bash(find:*)` rules only see the words of the line). Without `all`, anything else is
 * skipped: the walk finds the heavy commands wherever they are. A `cd` moves the rest of the
 * line; a shell of its own starts in this folder and its own `cd` stays inside it.
 */
function scan(
  command: string,
  kinds: Kinds,
  dialect: Dialect,
  depth: number,
  run: Run,
  all: boolean,
  out: Scan,
): boolean {
  // A quote left open is read blind: more pieces, so nothing hides inside it.
  const steps = shellSteps(command, { blindWhenOpen: true, dialect, joinLines: true });
  if (sendsToBackground(command, steps)) out.background = true;
  for (const step of steps) {
    const words = wordsOf(step.text, dialect);
    if (all && (words.length === 0 || isAssignmentOnly(words))) continue;
    const invocation = invocationOf(words);
    if (invocation === undefined) {
      if (all) return false;
      continue;
    }
    const { args } = invocation;
    // In a script's body, `$npm_execpath` is the package manager that ran the script.
    const program =
      run.runner !== undefined && NPM_EXECPATH.test(invocation.program)
        ? run.runner
        : invocation.program;
    // A redirection (`> out.txt`) is the shell's, never the tool's argument.
    const plain = withoutRedirections(args);
    // A `cd` moves the rest of the line: the script lookup reads the folder it moves to.
    if (CHANGE_DIR.has(program)) {
      run.folder = folderAfter(program, plain, run.folder);
      continue;
    }
    if (all && isRunnerProgram(program)) return false;
    // The queue's own command: whatever it runs is queued already, and must not nest.
    if (isJobRun(program, args)) out.queued = true;
    const inner = nestedCommand(program, args, step.pipedFrom);
    // The line a shell runs starts in this folder, and gets none of a script's extra arguments.
    const readInner = (line: string) =>
      depth < MAX_NESTING &&
      scan(line, kinds, nestedDialect(program), depth + 1, { ...run, extra: undefined }, all, out);
    if (all && inner !== undefined) {
      // A shell or wrapper that runs a line: that line must be pure too.
      if (!readInner(inner)) return false;
      continue;
    }
    const call = toolOf(program, run.extra === undefined ? plain : [...plain, ...run.extra]);
    const heavy = call !== undefined && matchCall(call, program, kinds, depth, run, all, out);
    if (all && !heavy) return false;
    if (inner !== undefined) readInner(inner);
  }
  return true;
}

/**
 * The heavy-job kind a shell command runs, or null. When it runs several (`tsc && next
 * build`), the first kind the line runs. A run that only prints (`tsc --version`) is no heavy
 * run; a package script is read by its body.
 */
export function classifyHeavyCommand(
  command: string,
  kinds: Kinds,
  source?: ScriptSource,
  dialect: Dialect = "bash",
): string | null {
  return readHeavy(command, kinds, source, dialect).kind;
}

/** One any-heavy read of a line: its first heavy kind, and whether it already runs `job run`. */
function readHeavy(
  command: string,
  kinds: Kinds,
  source: ScriptSource | undefined,
  dialect: Dialect,
): { kind: string | null; queued: boolean } {
  const out = newScan();
  scan(command, kinds, dialect, 0, runOf(source), false, out);
  return { kind: out.found.find((one) => !one.printOnly)?.kind ?? null, queued: out.queued };
}

/**
 * `classifyHeavyCommand`, except that a line which already runs `job run` (itself, or through a
 * script's body) gives null: the queue holds it, and a second queue around it would nest, so the
 * inner job would wait for its own parent's slot. The kind a caller may queue a command under;
 * `runWeight` and `routableLine` refuse the same line, by the same scan.
 */
export function classifyUnqueuedHeavy(
  command: string,
  kinds: Kinds,
  source?: ScriptSource,
  dialect: Dialect = "bash",
): string | null {
  const { kind, queued } = readHeavy(command, kinds, source, dialect);
  return queued ? null : kind;
}

/** How heavy one run is: light (starts at once), heavy (waits for a slot, of this kind), or none. */
export type Weight = { weight: "light" } | { weight: "heavy"; kind: string } | { weight: "none" };

/** True when this run takes no slot: it only prints, or names only existing files. */
function isLight(one: Found, kinds: Kinds, source: WeightSource): boolean {
  if (one.printOnly) return true;
  const spec = kinds[one.kind];
  const { folder } = one;
  if (spec === undefined || folder === null || one.compound) return false;
  return namesOnlyFiles(spec, one.call.args, (word) => source.isFile(folder, word), one.tool);
}

/**
 * How heavy the heavy commands of a line are, read the way the shell would run them: through a
 * shell's `-c` string, a wrapper and a package script, with each command's files read in the
 * folder it runs in (after a `cd`).
 *
 * - **light**: every heavy command only prints (`isPrintOnly`), or names only existing files
 *   under its kind's `noSlotForFiles`. A positive finding only: a command the reader cannot
 *   place is not light. Several heavy runs sent to the background (`a & b &`) are not light.
 * - **heavy**: the first heavy command that is not light, with its kind.
 * - **none**: no heavy command in the line, a watch run (`--watch`, `vitest watch`) that
 *   never ends and so must never wait for a slot, or a line that runs `job run` already (a
 *   script whose body queues itself): queued once, never again. `classifyHeavyCommand` still
 *   reports the kind of such a line: the route's reservation reads it.
 *
 * It does not say whether the line may be queued: `routableLine` does (every command heavy).
 */
export function runWeight(line: string, kinds: Kinds, source: WeightSource): Weight {
  const out = newScan();
  const run = runOf(source);
  scan(line, kinds, "bash", 0, run, false, out);
  const { found } = out;
  const first = found[0];
  // A line that runs `job run` (itself, or through a script's body) is queued already: a second
  // queue around it would nest, and the inner job would wait for its own parent's slot.
  if (first === undefined || out.queued) return { weight: "none" };
  if (found.some((one) => one.tool !== undefined && isWatchRun(one.tool, one.call.args))) {
    return { weight: "none" };
  }
  const heavy = found.find((one) => !isLight(one, kinds, source));
  if (heavy !== undefined) return { weight: "heavy", kind: heavy.kind };
  // Every heavy run is light, but a line is light only when it is nothing else: a command the
  // reader does not know (`make all`, `./build.sh`) may be the heavy work.
  if (!everyCommandUnderstood(line, kinds, source, run.cache)) {
    return { weight: "heavy", kind: first.kind };
  }
  return found.length > 1 && out.background
    ? { weight: "heavy", kind: first.kind }
    : { weight: "light" };
}

/**
 * True when every command of the line is one the reader understands: a `cd`, an assignment, a
 * heavy-kind command (a run that only prints too), a script followed into its body, or, at the
 * end, the read-only filters a routed line may pipe into. The same every-command walk the route
 * uses (`routableKinds`), in its mode that accepts print-only runs.
 */
function everyCommandUnderstood(
  line: string,
  kinds: Kinds,
  source: WeightSource,
  cache: Run["cache"],
): boolean {
  const run: Run = { ...runOf(source), cache, printOk: true };
  return scan(cutAtFilters(line).heavy, kinds, "bash", 0, run, true, newScan());
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
  if (redirectionTargets(filled).some((target) => target !== "/dev/null")) return false;
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
 * The line cut before its trailing read-only filters (`tsc 2>&1 | tail -20` gives `tsc 2>&1`
 * and `| tail -20`), or the whole line with no filters when it has none to cut. The route queues
 * the first part; the weight understands it, and the filters are read-only by their own list.
 */
function cutAtFilters(line: string): { heavy: string; filters: string } {
  const split = splitAtFilters(line.trim());
  return split !== null && feedsFiltersAlone(split.heavy) ? split : { heavy: line, filters: "" };
}

/**
 * The kinds a line runs, when every command in it is heavy, a `cd`, or an assignment: null
 * as soon as one is anything else. The inner command of a shell (`bash -c "…"`) is read the
 * same way, so `bash -c "tsc && rm x"` is no pure line.
 */
function routableKinds(command: string, kinds: Kinds, source?: ScriptSource): string[] | null {
  const out = newScan();
  // A line that runs `job run` (itself, or through a script's body) is queued already.
  if (!scan(command, kinds, "bash", 0, runOf(source), true, out) || out.queued) return null;
  return out.found.map((one) => one.kind);
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
  const { heavy, filters } = cutAtFilters(bashCommand);
  const kind = routableKinds(heavy, kinds, source)?.[0];
  return kind === undefined ? null : { filters, heavy, kind };
}

/** `routableLine`'s kind alone: the heavy-job kind to queue a Bash line under, or null. */
export function classifyRoutableLine(
  bashCommand: string,
  kinds: Kinds,
  source?: ScriptSource,
): string | null {
  return routableLine(bashCommand, kinds, source)?.kind ?? null;
}
