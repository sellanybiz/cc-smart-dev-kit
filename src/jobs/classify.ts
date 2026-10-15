/**
 * Which heavy-job kind does a Bash command run, if any? `classifyHeavyCommand` reads the
 * command with the shell lexer (`src/shell/command.ts`), so a tool named inside quotes,
 * a here-doc, a comment or an `echo` is text, not a run.
 *
 * It finds the tool behind the usual runners: `bunx`, `bun x`, `bun run`, `bun <name>`,
 * `npx`, `npm exec`, `npm run`, `pnpm`, `yarn`, a `node_modules/.bin/` path, `node <script
 * path>`, and the wrappers `time`, `timeout`, `nice`, `env`, `sudo`, `bash -c "…"`. A
 * `package.json` script is matched only by a kind's `{ "script": … }` rule: the classifier
 * reads no file, so it cannot know what a script runs.
 *
 * Pure: no file, no environment. A later hook routes what it finds through `job run`.
 */

import { invocationOf, MAX_NESTING, nestedCommand, shellSegments, wordsOf } from "../shell/command";
import type { KindSpec, Kinds, MatchRule } from "./kinds";

/** What a command really runs: a program (by name) and its arguments. */
export interface ToolCall {
  /** The program's name: no folder, no `.exe`, no `@version`, a script path's base name. */
  name: string;
  args: string[];
  /** Set when the word may name a `package.json` script (`bun run <name>`, `yarn <name>`). */
  script?: string;
}

/** Options whose value is the next word, per runner: so the value is not the program. */
const BUN_VALUED = ["--config", "--cwd", "--env-file", "--filter", "--preload", "-c", "-F", "-r"];
const NPX_VALUED = ["--package", "-p", "--call", "-c", "--workspace", "-w"];
const PNPM_VALUED = ["--filter", "-F", "--dir", "-C", "--workspace-root"];
const TIMEOUT_VALUED = ["--kill-after", "--signal", "-k", "-s"];
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

/** The program a command really runs, behind the runners and wrappers in the header. */
export function toolOf(program: string, args: string[], depth = 0): ToolCall | undefined {
  if (depth > 4) return undefined;
  const again = (words: string[]) => {
    const inner = invocationOf(words);
    return inner === undefined ? undefined : toolOf(inner.program, inner.args, depth + 1);
  };
  const at = (valued: readonly string[], from = 0) => firstWord(args, from, valued);
  switch (program) {
    case "timeout":
      return again(args.slice(at(TIMEOUT_VALUED) + 1));
    case "nice":
      return again(args.slice(at(["-n"])));
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

/** Does `rule` match what the command runs? */
export function ruleMatches(rule: MatchRule, call: ToolCall): boolean {
  if ("script" in rule) return call.script === rule.script;
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
function kindOfCall(call: ToolCall, kinds: Kinds): { name: string; gb: number } | null {
  let best: { name: string; gb: number } | null = null;
  for (const [name, kind] of Object.entries(kinds)) {
    const heavy = (kind.match ?? []).some(
      (rule) =>
        ruleMatches(rule, call) &&
        // A program that only prints (`tsc --version`) is not heavy; a script is a script.
        ("script" in rule || !printsOnly(kind, call.args)),
    );
    if (heavy && (best === null || kind.gb > best.gb)) best = { name, gb: kind.gb };
  }
  return best;
}

function inspect(command: string, kinds: Kinds, depth: number): { name: string; gb: number }[] {
  const found: { name: string; gb: number }[] = [];
  // A quote left open is read blind: more pieces, so nothing hides inside it.
  for (const segment of shellSegments(command, { blindWhenOpen: true, joinLines: true })) {
    const invocation = invocationOf(wordsOf(segment));
    if (invocation === undefined) continue;
    const { program, args } = invocation;
    const call = toolOf(program, args);
    const kind = call === undefined ? null : kindOfCall(call, kinds);
    if (kind !== null) found.push(kind);
    const inner = nestedCommand(program, args);
    if (inner !== undefined && depth < MAX_NESTING) found.push(...inspect(inner, kinds, depth + 1));
  }
  return found;
}

/**
 * The heavy-job kind a Bash command runs, or null. When it runs several (`tsc && next
 * build`), the one that reserves the most, so a hook that wraps the whole line reserves
 * enough for its largest step.
 */
export function classifyHeavyCommand(bashCommand: string, kinds: Kinds): string | null {
  let best: { name: string; gb: number } | null = null;
  for (const kind of inspect(bashCommand, kinds, 0)) {
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
