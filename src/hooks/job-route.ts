/**
 * The `job-route` hook: PreToolUse on Bash, for a project that turned it on
 * (`"jobs": { "route": true }` in `.claude/anymodel.json`). A heavy command — one of the
 * project's heavy-job kinds (`classifyHeavyCommand`, `src/jobs/`) — is sent through the
 * machine's queue instead of running raw: several sessions running builds, type checks and
 * test runs at once run the machine out of memory.
 *
 * **Opt-in, because it changes the command.** The project says so in its own file, and the
 * hook is in `HOOKS`, so `ownHooks` can silence it where a project keeps its own copy.
 *
 * Two ways to send it, and the hook uses the first its Claude Code supports:
 *   - **rewrite** (`updatedInput`, proved live on 2.1.301): the call runs
 *     `anymodel job run --kind <kind> -- <command>` instead, byte for byte the same command.
 *   - **deny**: the same command line, named in the reason, for the session to run.
 *
 * The command is passed through as argv words when it is one plain command
 * (`bun run test:run x.ts`), and through `/bin/sh -c <quoted line>` otherwise (`a && b`,
 * a pipe, an expansion): a shell string the shell runs exactly as it would have.
 *
 * A command already inside `anymodel job run` stays as it is (the queue would nest), and
 * anything the hook cannot read lets the call through.
 */
import { COMMAND } from "../build-info/names";
import { classifyHeavyCommand } from "../jobs/classify";
import { type Kinds, mergeKinds } from "../jobs/kinds";
import { shellQuote } from "../setup/launcher";
import { invocationOf, nestedCommand, shellSegments, wordsOf } from "../shell/command";
import {
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";
import type { HookContext } from "./run";

/** The launcher, as a shell finds it from a hook or a rewritten command: its path under $HOME. */
export const LAUNCHER_IN_SHELL = `"$HOME/.local/bin/${COMMAND}"`;

/** A word that needs no quoting for a shell to keep it as it is. */
const PLAIN_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * A character whose shell meaning quoting would change (an expansion, a glob, a redirect, a
 * separator, an escape): the word must go through the shell, not around it.
 */
const SHELL_MEANING = /[$`*?[\]{}~<>|&;\n\\]/;

/**
 * The words of one plain command: one segment, no shell meaning in any word, and the first
 * word is the program itself (no `VAR=1`, no `time` / `env` / `sudo` prefix, no assignment
 * the argv form would drop).
 */
function plainWords(command: string): null | string[] {
  const segments = shellSegments(command);
  if (segments.length !== 1) return null;
  const words = wordsOf(segments[0] ?? "");
  if (words.length === 0 || !words.every((word) => !SHELL_MEANING.test(word))) return null;
  const invocation = invocationOf(words);
  return invocation === undefined || invocation.program !== words[0] ? null : words;
}

/** One word for the shell: bare when it is plain, quoted otherwise. */
function shellWord(word: string): string {
  return PLAIN_WORD.test(word) ? word : shellQuote(word);
}

/**
 * The command that runs `command` through the queue: `anymodel job run --kind <kind> -- …`.
 * One plain command goes in as its own words; anything else through `/bin/sh -c`, so the
 * shell reads exactly the line the person wrote.
 */
export function jobRunCommand(kind: string, command: string): string {
  const words = plainWords(command);
  const inner = words === null ? `sh -c ${shellQuote(command)}` : words.map(shellWord).join(" ");
  return `${LAUNCHER_IN_SHELL} job run --kind ${kind} -- ${inner}`;
}

/** True when the line already runs `anymodel job run` (that queue must not nest). */
export function runsJobRun(command: string): boolean {
  return shellSegments(command).some((segment) => {
    const words = wordsOf(segment);
    const inner = invocationOf(words);
    if (inner === undefined) return false;
    if (isJobRun(inner.program, inner.args)) return true;
    const nested = nestedCommand(inner.program, inner.args);
    if (nested === undefined) return false;
    const deeper = invocationOf(wordsOf(nested));
    return deeper !== undefined && isJobRun(deeper.program, deeper.args);
  });
}

/** `anymodel job run …`, whatever path the launcher is named by. */
function isJobRun(program: string, args: string[]): boolean {
  const base = (program.split(/[\\/]/).pop() ?? program).replace(/\.(cmd|exe|ps1|bat)$/, "");
  return base === COMMAND && args[0] === "job" && args[1] === "run";
}

/** The kind a command runs, and the queue command that would run it instead. */
export interface Routed {
  command: string;
  kind: string;
}

/** The route for a heavy command, or null when there is nothing to route. Pure. */
export function routeHeavyCommand(command: string, kinds: Kinds): null | Routed {
  if (runsJobRun(command)) return null;
  const kind = classifyHeavyCommand(command, kinds);
  return kind === null ? null : { command: jobRunCommand(kind, command), kind };
}

/**
 * Does this Claude Code accept `updatedInput` on a PreToolUse hook's answer? Proved live on
 * 2.1.301 (docs/claude-code-contract.md, § Hooks): the rewritten command ran in the Bash
 * tool's own shell and kept the folder that shell was in after a `cd`. If a version ever
 * ignores it, flip this to false and every routed command is denied with the command to run
 * instead — never silently left raw.
 */
export const REWRITE_SUPPORTED = true;

/**
 * The answer that makes the call run the queue command instead: the same tool input, its
 * `command` replaced. **No `permissionDecision`**: the hook replaces the input and the
 * permission system still decides about the rewritten command, so a person's own deny or ask
 * rule for Bash is not overridden by the rewrite (proved live on 2.1.301: without a decision
 * Claude Code ran the rewritten command).
 */
export function rewriteAnswer(fields: Record<string, unknown>, routed: Routed): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...fields, command: routed.command },
      },
    }),
  };
}

/** The answer that refuses the raw call and names the command to run instead. */
export function routeDenial(routed: Routed): HookResult {
  return toolDecision(
    "deny",
    [
      `This is a heavy command (${routed.kind}): running it raw does not wait for free memory, and parallel heavy runs have run machines out of memory.`,
      "Run it through the queue instead:",
      routed.command,
    ].join("\n"),
  );
}

/** The hook: on, heavy, and not already queued — rewrite the call or refuse it. */
export function jobRoute(context: HookContext): HookResult {
  if (context.project.config?.jobs?.route !== true) return SILENT;
  const fields = toolInput(context.input);
  const command = stringField(fields.command);
  if (command === null) return SILENT;
  const routed = routeHeavyCommand(command, mergeKinds(context.project.config.jobs?.kinds));
  if (routed === null) return SILENT;
  return REWRITE_SUPPORTED ? rewriteAnswer(fields, routed) : routeDenial(routed);
}

/** The facts for the hook log: what the route read, so `doctor --live` can prove it. */
export function routeFacts(input: HookInput): Record<string, unknown> {
  const command = stringField(toolInput(input).command);
  if (command === null) return {};
  return { job_run: runsJobRun(command) };
}
