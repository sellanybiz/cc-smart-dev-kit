/**
 * The `job-route` hook: PreToolUse on Bash, the kit's one Bash judge. It keeps its public name
 * (`ownHooks` values, project files and `hooks.json` stay valid) and does two jobs.
 *
 * **The launch judge** (`bash-judge.ts`, the rules; this file, the answer). It is
 * **machine-wide** (`HookSpec.alwaysOn`): a raw `claude --bg` asks the person (and is refused in
 * `claude -p`) and shows the `crew start` line; `claude -p` is judged by the launch policy
 * (`judgeLaunch`, the same one the Agent guard uses); a crew session's `crew start` is denied;
 * and a polling loop over `crew list|status` or `claude agents --json` is denied. **It ignores
 * the project's file**: a session cannot switch the limits on its own launches off by editing
 * `cc-smart-dev-kit.json`, so the frame skips the `ownHooks` step for this hook. It runs
 * outside git too, and with a broken or too new `cc-smart-dev-kit.json`.
 *
 * **The job route** (the project's opt-in, `"jobs": { "route": true }`, the same value as
 * `switches.jobRoute` in `src/workflow/resolve.ts`). A heavy command — one of the project's
 * heavy-job kinds (`classifyRoutableLine`, `src/jobs/`) — is sent through the machine's queue
 * instead of running raw: several sessions running builds, type checks and test runs at once
 * run the machine out of memory.
 *
 * Two ways to send it, and the hook uses the first its Claude Code supports:
 *   - **rewrite** (`updatedInput`, proved live on 2.1.301): the call runs
 *     `cc-smart-dev-kit job run --kind <kind> -- <command>` instead, byte for byte the same command.
 *   - **deny**: the same command line, named in the reason, for the session to run.
 *
 * **A lead never waits on what it started** (D22): in a session recorded as a lead (`crew lead`,
 * `readLead`), a CI watch (`gh pr checks --watch`, `gh run watch`), a queued job and the
 * project's full check (`bun run check`, …, its package manager's `check` script) are moved to
 * the background with `run_in_background: true` (proved honoured on 2.1.308, and in L1a.1 on
 * 2.1.306), so the lead goes on to what the news unblocks. A routed heavy job gets both in one
 * rewrite.
 *
 * The command is passed through as argv words when it is one plain command
 * (`bun run test:run x.ts`), and through a shell otherwise (`a && b`, a pipe, an expansion):
 * **the person's own shell** (`routedShell`), so a line written for bash reads the same
 * through the queue as it does in the terminal. The rewritten command runs in the Bash tool's
 * own shell and starts in the folder that shell is in; a `cd` **inside** the command lives
 * only for that command, and does not move the Bash tool's folder for the next call.
 *
 * A command already inside `cc-smart-dev-kit job run` stays as it is (the queue would nest), and
 * anything the hook cannot read lets the call through.
 */
import { readLead } from "../crew/store";
import { classifyHeavyCommand, classifyRoutableLine } from "../jobs/classify";
import { type Kinds, mergeKinds } from "../jobs/kinds";
import { LAUNCHER_IN_SHELL, shellQuote } from "../setup/launcher";
import { invocationOf, nestedCommand, shellSegments, wordsOf } from "../shell/command";
import {
  type BashReading,
  type BashVerdict,
  backgroundFor,
  commandOf,
  isJobRun,
  judgeAnswer,
  judgeBash,
  judgedDomain,
  readBash,
} from "./bash-judge";
import {
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";
import type { Env, HookContext, HookEnvContext } from "./run";

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
 * The shell a routed line runs in: **the person's own**, so a line with bash syntax (`[[ … ]]`,
 * `source`, an array, `$'…'`) reads the same through the queue as it does in the terminal.
 * `/bin/sh` is dash on Debian and Ubuntu, and a shell string the person wrote for bash is not
 * a shell string dash can read.
 *
 * `$SHELL` when it is bash or zsh (the login shell, normally an absolute path); else `bash`
 * where this machine has it on PATH; else `sh`, the smallest shell every machine has.
 */
export function routedShell(
  env: Env,
  which: (command: string) => null | string = (command) =>
    Bun.which(command, { PATH: env.PATH ?? "" }),
): string {
  const shell = env.SHELL ?? "";
  const name = shell.split("/").pop() ?? "";
  if (name === "bash" || name === "zsh") return shell;
  return which("bash") ?? "sh";
}

/**
 * The command that runs `command` through the queue: `cc-smart-dev-kit job run --kind <kind> -- …`.
 * One plain command goes in as its own words; anything else through `shell -c`, so the shell
 * reads exactly the line the person wrote.
 */
export function jobRunCommand(kind: string, command: string, shell: string): string {
  const words = plainWords(command);
  const inner =
    words === null
      ? `${shellWord(shell)} -c ${shellQuote(command)}`
      : words.map(shellWord).join(" ");
  return `${LAUNCHER_IN_SHELL} job run --kind ${kind} -- ${inner}`;
}

/** True when the line already runs `cc-smart-dev-kit job run` (that queue must not nest). */
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

/** The kind a command runs, and the queue command that would run it instead. */
export interface Routed {
  command: string;
  kind: string;
}

/** The route for a heavy command, or null when there is nothing to route. Pure. */
export function routeHeavyCommand(command: string, kinds: Kinds, shell: string): null | Routed {
  if (runsJobRun(command)) return null;
  const kind = classifyRoutableLine(command, kinds);
  return kind === null ? null : { command: jobRunCommand(kind, command, shell), kind };
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
 * The answer that makes the call run `command` instead: the same tool input, its `command`
 * replaced, and — for a lead's CI watch, queued job or full check — `run_in_background: true`
 * added (proved honoured, L1a.1: the call moves to the background and its exit starts a new
 * turn). **No `permissionDecision`**: the hook replaces the input and the permission system
 * still decides about the rewritten command, so a person's own deny or ask rule for Bash is not
 * overridden by the rewrite (proved live on 2.1.301: without a decision Claude Code ran the
 * rewritten command).
 */
export function rewriteAnswer(
  fields: Record<string, unknown>,
  command: string,
  background = false,
): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...fields, command, ...(background ? { run_in_background: true } : {}) },
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

/**
 * True when this project routes its heavy commands: `jobs.route` in its own file. That field
 * IS the `switches.jobRoute` switch (`src/workflow/resolve.ts` builds the switch from it), so
 * the hook reads it here rather than resolving the whole workflow for one boolean.
 */
export function routesHeavyCommands(config: HookContext["project"]["config"]): boolean {
  return config?.jobs?.route === true;
}

/**
 * True when the calling session is a lead recorded in this repository (`crew lead`): the one
 * session whose waits the hook moves to the background. A store that cannot be read is not a
 * lead — the call runs as the model wrote it.
 */
export function isLead(context: HookContext): boolean {
  const sessionId = stringField(context.input.session_id);
  if (sessionId === null) return false;
  try {
    const repo = context.project.mainCheckout ?? context.project.root;
    return readLead(context.paths.stateDir, repo, sessionId) !== null;
  } catch {
    return false;
  }
}

/** The judge's answer for one command, or null; the part that runs outside the project. */
export function judgeCommandAnswer(input: HookInput, context: HookEnvContext): null | HookResult {
  const command = commandOf(input);
  if (command === null) return null;
  const verdict = judgeBash(readBash(command), {
    env: context.env,
    input,
    paths: context.paths,
  });
  return verdict === null ? null : judgeAnswer(verdict);
}

/**
 * The hook: the judge first, then the route and the lead's background move.
 *
 * A judged line answers the judge and goes no further: an ask or a denial is never combined
 * with a rewrite. A line already asking for the background keeps its own input.
 */
export function jobRoute(context: HookContext): HookResult {
  const fields = toolInput(context.input);
  const command = stringField(fields.command);
  if (command === null) return SILENT;
  const reading: BashReading = readBash(command);
  const verdict: BashVerdict | null = judgeBash(reading, {
    env: context.env,
    input: context.input,
    paths: context.paths,
  });
  if (verdict !== null) return judgeAnswer(verdict);
  const background = backgroundFor(reading.top);
  const routed = routesHeavyCommands(context.project.config)
    ? routeHeavyCommand(
        command,
        mergeKinds(context.project.config?.jobs?.kinds),
        routedShell(context.env),
      )
    : null;
  // The lead's record is one file read, so only a line it could move to the background asks for
  // it: a `git status` never reads the crew store.
  const lead = routed !== null || background !== null ? isLead(context) : false;
  if (routed !== null) {
    // A lead waits for neither the queue nor the heavy job itself: the rewrite carries both.
    return REWRITE_SUPPORTED ? rewriteAnswer(fields, routed.command, lead) : routeDenial(routed);
  }
  if (lead && background !== null && fields.run_in_background !== true) {
    return rewriteAnswer(fields, command, true);
  }
  return SILENT;
}

/**
 * The answer when cc-smart-dev-kit.json is broken or needs a newer plugin. The judge runs
 * anyway (it ignores the file). Otherwise routing cannot be read: a heavy command is asked
 * about rather than run raw, exactly as before. A line outside both is left alone.
 */
export function jobRouteConfigAnswer(
  message: string,
  input: HookInput,
  context: HookEnvContext,
): HookResult {
  const judged = judgeCommandAnswer(input, context);
  if (judged !== null) return judged;
  const command = commandOf(input);
  if (command === null || classifyHeavyCommand(command, mergeKinds(undefined)) === null) {
    return SILENT;
  }
  return toolDecision(
    "ask",
    `cc-smart-dev-kit cannot check whether this project routes heavy commands through its job queue: ${message}`,
  );
}

/** The answer outside git: the judge alone (routing is a project's, and there is none here). */
export function jobRouteOutsideGit(input: HookInput, context: HookEnvContext): HookResult {
  return judgeCommandAnswer(input, context) ?? SILENT;
}

/** True when a crash must ask: the line is judged, or a heavy command by the default kinds. */
export function jobRouteDomain(input: HookInput): boolean {
  const command = commandOf(input);
  if (command === null) return false;
  return (
    judgedDomain(readBash(command)) || classifyHeavyCommand(command, mergeKinds(undefined)) !== null
  );
}

/**
 * The facts for the hook log: what the judge read (its launches, polls and decision) and
 * whether the line already runs `job run`, so `doctor --live` can prove both parts answered.
 */
export function routeFacts(input: HookInput, context: HookEnvContext): Record<string, unknown> {
  const command = commandOf(input);
  if (command === null) return {};
  const reading = readBash(command);
  const verdict = judgeBash(reading, { env: context.env, input, paths: context.paths });
  const facts: Record<string, unknown> = { job_run: runsJobRun(command) };
  if (reading.launches.length > 0) facts.launches = reading.launches.map((one) => one.form);
  if (reading.crewStarts > 0) facts.crew_starts = reading.crewStarts;
  if (reading.statusReads > 0) {
    facts.status_reads = reading.statusReads;
    facts.waits = reading.waits;
  }
  if (verdict !== null) {
    facts.decision = verdict.decision;
    facts.why = verdict.why;
  }
  return facts;
}
