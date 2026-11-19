/**
 * What a command really runs: the one tool reader. `toolOf` finds the program behind the usual
 * runners (`npx`, `bunx`, `bun x`, `npm exec`, `pnpm|yarn exec|dlx`, a package manager's script
 * words, `node <script path>`, a shell or interpreter given a script file), `toolName` names a
 * program word, `ruleMatches` tests a match rule (`matchRuleSchema`, `src/jobs/kinds.ts`) against
 * what it found, and `ruleOfCommand` turns one command typed as text into such a rule.
 *
 * Pure: no file, no environment. The job classifier (`src/jobs/classify.ts`) and the deploy
 * guard (`src/hooks/deploy-guard.ts`) read a command through it, so both see the same tool.
 */

import type { MatchRule } from "../jobs/kinds";
import { invocationOf, shellSteps, withoutRedirections, wordsOf } from "./command";

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
      // `node node_modules/vitest/vitest.mjs run` and `node deploy.js` run the file as the tool.
      const index = at(NODE_VALUED);
      const script = args[index];
      return script === undefined ? undefined : fileRun(script, args.slice(index + 1));
    }
    case "source":
    case ".": {
      // `source deploy.sh prod` and `. deploy.sh prod` run the file in this shell.
      const file = args[0];
      return file === undefined ? { name: program, args } : fileRun(file, args.slice(1));
    }
    default:
      return (
        (SHELLS_WITH_FILES.has(program) ? shellFileRun(args) : undefined) ??
        (PYTHON.test(program) ? pythonFileRun(args) : undefined) ?? { name: program, args }
      );
  }
}

/** What a script file given to a shell or an interpreter runs: the file's tool, the words after it. */
function fileRun(file: string, rest: string[]): ToolCall {
  return { name: toolName(file), args: rest };
}

/** The shells that run a script file they are given (`bash deploy.sh`). */
const SHELLS_WITH_FILES: ReadonlySet<string> = new Set(["bash", "dash", "ksh", "sh", "zsh"]);

/** Long options of these shells that take the next word. */
const SHELL_VALUED_LONG = ["--init-file", "--rcfile"];

/**
 * `bash -o pipefail deploy.sh prod` runs `deploy.sh`: the options before it are stepped over,
 * and a short option that takes a value (`-o`, `-O`, also as `+o`) with its value. Undefined when
 * the shell runs no file: `-c` (a command string, which `nestedCommand` reads), `-s` (its script
 * comes from standard input) or no word left.
 */
function shellFileRun(args: readonly string[]): ToolCall | undefined {
  for (let index = 0; index < args.length; index++) {
    const word = args[index] ?? "";
    if (word === "--") {
      const file = args[index + 1];
      return file === undefined ? undefined : fileRun(file, args.slice(index + 2));
    }
    if (word.startsWith("--")) {
      index += SHELL_VALUED_LONG.includes(word) ? 1 : 0;
      continue;
    }
    if (word.length > 1 && (word.startsWith("-") || word.startsWith("+"))) {
      const letters = word.slice(1);
      if (letters.includes("c") || letters.includes("s")) return undefined;
      index += /[oO]$/.test(letters) ? 1 : 0;
      continue;
    }
    return fileRun(word, args.slice(index + 1));
  }
  return undefined;
}

/** `python`, `python3`, `python3.12`. */
const PYTHON = /^python[0-9.]*$/;

/** Python's own options that take the next word. */
const PYTHON_VALUED = ["-W", "-X", "-Q", "--check-hash-based-pycs"];

/** `python deploy.py prod` runs the file; `-c` (code), `-m` (a module) and `-` (stdin) run none. */
function pythonFileRun(args: readonly string[]): ToolCall | undefined {
  for (let index = 0; index < args.length; index++) {
    const word = args[index] ?? "";
    if (word === "-") return undefined;
    if (word === "--") {
      const file = args[index + 1];
      return file === undefined ? undefined : fileRun(file, args.slice(index + 2));
    }
    if (word.startsWith("-")) {
      if (/^-[bBdEhiIOPqRsSuvVx]*[cm]/.test(word)) return undefined;
      index += PYTHON_VALUED.includes(word) ? 1 : 0;
      continue;
    }
    return fileRun(word, args.slice(index + 1));
  }
  return undefined;
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

/**
 * What the program and arguments of one command run, redirections left out (`> log.txt` is the
 * shell's, never the tool's argument). A program `toolOf` cannot see behind is itself, so a
 * rule made from a command's text and the same command run later give the same tool.
 */
export function callOf(program: string, args: readonly string[]): ToolCall {
  const plain = withoutRedirections(args);
  return toolOf(program, plain) ?? { name: program, args: plain };
}

/** An option word: `--prod`, `-f`; a lone `-` is a word (standard input). */
const isOptionWord = (word: string): boolean => word.startsWith("-") && word !== "-";

/**
 * One command typed as text (`vercel --prod`, `npm run deploy:prod`), as a rule of the jobs
 * grammar. The command is read as a run of it would be: the shell reader's first command, with
 * a quote that never closes read blind, assignments and wrappers stepped over (`invocationOf`),
 * its redirections dropped, the tool found by `callOf`. So the rule never asks for a word a run
 * would not hold (`vercel --prod > log.txt` is `vercel --prod`).
 *
 * - A package manager's script (`npm run x`, `pnpm x`, `bun run x`) gives `{ script }`, which
 *   every spelling of that script matches.
 * - Anything else gives the tool, its words that are no option, in order (`sub`), and its option
 *   words (`flags`). Each must be in the run, as a whole word.
 *
 * Undefined when the text runs nothing (an assignment alone, `command -v x`).
 */
export function ruleOfCommand(text: string): MatchRule | undefined {
  for (const step of shellSteps(text, { blindWhenOpen: true, dialect: "bash", joinLines: true })) {
    const invocation = invocationOf(wordsOf(step.text, "bash"));
    if (invocation === undefined) continue;
    const call = callOf(invocation.program, invocation.args);
    if (call.script !== undefined) return { script: call.script };
    const sub = call.args.filter((word) => !isOptionWord(word));
    const flags = call.args.filter(isOptionWord);
    return {
      tool: call.name,
      ...(sub.length > 0 ? { sub } : {}),
      ...(flags.length > 0 ? { flags } : {}),
    };
  }
  return undefined;
}
