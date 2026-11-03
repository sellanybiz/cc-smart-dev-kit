/**
 * The `job-route` hook: PreToolUse on Bash and PowerShell, the kit's one shell judge. It keeps
 * its public name (`ownHooks` values, project files and `hooks.json` stay valid) and does two
 * jobs.
 *
 * **The launch judge** (`bash-judge.ts`, the rules; this file, the answer). It is
 * **machine-wide** (`HookSpec.alwaysOn`): a raw `claude --bg` asks the person (and is refused in
 * `claude -p`); `claude -p` is judged by the launch policy (`judgeLaunch`, the same one the
 * Agent guard uses); and `workflow propose` asks where the push gate says the push or the pull
 * request is the person's. **It ignores the project's file**: a session cannot switch the
 * limits on its own launches off by editing `cc-smart-dev-kit.json`, so the frame skips the
 * `ownHooks` step for this hook. It runs outside git too, and with a broken or too new
 * `cc-smart-dev-kit.json`.
 *
 * **Both shells.** The hook is wired on Bash and PowerShell, and it reads a line in the
 * dialect of the tool that runs it (`dialectOfTool`): on native Windows the PowerShell tool is
 * one command away, and a judge that read only Bash would let a launch through
 * there. The queue's rewrite stays Bash-only: the rewritten line names the launcher and, for
 * anything but one plain command, a `sh -c` line, which the PowerShell tool cannot run, and a
 * wrong rewrite is worse than none. So where the route is on, a PowerShell line that runs a
 * heavy command is **refused**, with the Bash tool and (for one plain command) the exact Bash
 * line to run there, which the Bash tool then queues (`powerShellDenial`). Only where the Bash
 * tool exists: on Windows it needs Git Bash, and with none
 * (`bashToolExists`) the line is left as written. Any other PowerShell line is judged and left
 * as it is.
 *
 * **The job route** (the switch `switches.jobRoute`: the project's `"jobs": { "route": true }`
 * when it sets one, else the person's machine-wide default in their workflow file, else off;
 * one resolver decides it, `resolveJobRoute` in `src/workflow/resolve.ts`, and runs with no
 * project file too). A heavy command — one of the project's heavy-job kinds
 * (`classifyRoutableLine`, `src/jobs/`) — is sent through the machine's queue instead of running
 * raw: several sessions running builds, type checks and test runs at once run the machine out
 * of memory, or fight for the same cores. Outside git there is no project, so the route does
 * not apply there: a heavy command runs raw. The classifier reads the project's `package.json`
 * in the folder the line runs in (the `cwd` the hook was given, and after a `cd`, the folder it
 * moves to), only to tell a script from the tool of the same name: a `tsc` script that already
 * wraps the job is not wrapped a second time. A heavy command piped into read-only filters
 * (`tsc --noEmit 2>&1 | tail -20`, the list is `READ_ONLY_FILTERS`) is queued without them: the
 * filters stay after the queue's command, where the person's own Bash rules see them.
 *
 * Two ways to send it, and the hook uses the first its Claude Code supports:
 *   - **rewrite** (`updatedInput`, proved live on 2.1.301): the call runs
 *     `cc-smart-dev-kit job run --kind <kind> -- <command>` instead, byte for byte the same command.
 *   - **deny**: the same command line, named in the reason, for the session to run.
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

import { existsSync } from "node:fs";
import { findGitBash, type GitBashFacts } from "../cli/git-bash";
import { classifyHeavyCommand, routableLine, type ScriptSource } from "../jobs/classify";
import { type Kinds, mergeKinds } from "../jobs/kinds";
import { packageScripts } from "../jobs/package-scripts";
import { LAUNCHER_IN_SHELL, shellQuote } from "../setup/launcher";
import {
  type Dialect,
  dialectOfTool,
  invocationOf,
  nestedCommand,
  programName,
  shellSegments,
  withoutRedirections,
  wordsOf,
  wordsWithFill,
} from "../shell/command";
import { resolveJobRoute } from "../workflow/resolve";
import {
  type BashVerdict,
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

/**
 * The route for a heavy command, or null when there is nothing to route. Pure: `source` is the
 * folder the line runs in and the reader of its `package.json`, so the classifier tells a
 * project's script from a tool of the same name without reading a file itself.
 *
 * A line that pipes its heavy command into read-only filters (`tsc --noEmit 2>&1 | tail -20`)
 * queues the heavy part only and keeps the filters after it, outside the queue's command:
 * `… job run --kind tsc -- bash -c 'tsc --noEmit 2>&1' | tail -20`. So the person's own Bash
 * rules still see the filters; a redirection of the heavy part (`2>&1`) stays with it, and the
 * queue's own lines (a wait, a note) go to its stderr, where no filter hides them. No
 * `set -o pipefail` is added: the line keeps the pipeline the person wrote, so its exit code is
 * the one their shell gives that pipeline (the last filter's, unless they set `pipefail`).
 */
export function routeHeavyCommand(
  command: string,
  kinds: Kinds,
  shell: string,
  source?: ScriptSource,
): null | Routed {
  if (runsJobRun(command)) return null;
  const line = routableLine(command, kinds, source);
  if (line === null) return null;
  const queued = jobRunCommand(line.kind, line.heavy, shell);
  return {
    command: line.filters === "" ? queued : `${queued} ${line.filters}`,
    kind: line.kind,
  };
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
 * replaced. **No `permissionDecision`**: the hook replaces the input and the permission system
 * still decides about the rewritten command, so a person's own deny or ask rule for Bash is not
 * overridden by the rewrite (proved live on 2.1.301: without a decision Claude Code ran the
 * rewritten command).
 */
export function rewriteAnswer(fields: Record<string, unknown>, command: string): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { ...fields, command } },
    }),
  };
}

/**
 * Can the Bash tool run on this machine? Off Windows it always can. On Windows Claude Code runs
 * it through Git Bash, and without one there is no Bash tool at all: then a heavy PowerShell
 * line is left as written, because refusing it would leave the session no shell to run it in.
 * Git Bash is found the way Claude Code finds it (`findGitBash`); `platform` and `facts` are a
 * test's.
 */
export function bashToolExists(
  env: Env,
  platform: NodeJS.Platform = process.platform,
  facts: GitBashFacts = {
    exists: existsSync,
    which: (command) => Bun.which(command, { PATH: env.PATH ?? env.Path ?? "" }),
  },
): boolean {
  return platform !== "win32" || findGitBash(env, facts).path !== null;
}

/**
 * The same command as a Bash line, when the PowerShell line is one plain command: its words as
 * PowerShell hands them to the program, quoted again for Bash. Null for anything else — two
 * commands, a pipe, a redirection, a variable, a wrapper — which this hook does not translate.
 */
export function bashLineOf(powerShellCommand: string): null | string {
  const segments = shellSegments(powerShellCommand, { dialect: "powershell" });
  if (segments.length !== 1) return null;
  const filled = wordsWithFill(segments[0] ?? "", "powershell");
  if (filled.length === 0 || filled.some((word) => word.filled)) return null;
  const words = filled.map((word) => word.text);
  if (withoutRedirections(words).length !== words.length) return null;
  const invocation = invocationOf(words);
  if (
    invocation === undefined ||
    invocation.computed ||
    invocation.prefix.length > 0 ||
    invocation.program !== programName(words[0] ?? "")
  ) {
    return null;
  }
  return words.map(shellWord).join(" ");
}

/**
 * The refusal of a heavy PowerShell line, where heavy commands go through the queue: the queue
 * reads Bash lines only (its rewrite is a Bash line), so run raw here the command would not wait
 * for a slot. The reason names the Bash tool and, for one plain command, the exact Bash line —
 * which the Bash tool then queues. Null when the line runs nothing heavy (a print-only run such
 * as `tsc --version` is not heavy).
 */
export function powerShellDenial(
  command: string,
  kinds: Kinds,
  source?: ScriptSource,
): HookResult | null {
  const kind = classifyHeavyCommand(command, kinds, source, "powershell");
  if (kind === null) return null;
  const bash = bashLineOf(command);
  const queued = bash !== null && routableLine(bash, kinds, source) !== null;
  const why = `This is a heavy command (${kind}), and the job queue takes Bash lines only: run in PowerShell it would not wait for a free slot, and many heavy runs at once have run machines out of memory.`;
  return toolDecision(
    "deny",
    queued
      ? [
          why,
          "Run it with the Bash tool instead, where it waits for a slot in the queue:",
          bash,
        ].join("\n")
      : `${why}\nRun it with the Bash tool instead, written for Bash: there a heavy command alone (or after a cd, or piped into a filter such as tail) waits for a slot in the queue.`,
  );
}

/** The answer that refuses the raw call and names the command to run instead. */
export function routeDenial(routed: Routed): HookResult {
  return toolDecision(
    "deny",
    [
      `This is a heavy command (${routed.kind}): running it raw does not wait for a free slot, and many heavy runs at once have run machines out of memory.`,
      "Run it through the queue instead:",
      routed.command,
    ].join("\n"),
  );
}

/**
 * True when heavy commands go through the queue here: the resolved `switches.jobRoute` (the
 * project's `jobs.route` over the person's machine-wide default, `resolveJobRoute`). A personal
 * workflow file that cannot be read leaves the project's value and the default standing, so a
 * hook never fails on it.
 */
export function routesHeavyCommands(context: HookContext): boolean {
  return resolveJobRoute(context.paths, context.project.config).value;
}

/** The judge's answer for one command, or null; the part that runs outside the project. */
export function judgeCommandAnswer(input: HookInput, context: HookEnvContext): null | HookResult {
  const command = commandOf(input);
  if (command === null) return null;
  const verdict = judgeBash(readBash(command, inputDialect(input)), {
    env: context.env,
    input,
    paths: context.paths,
    startedAtMs: context.nowMs,
  });
  return verdict === null ? null : judgeAnswer(verdict);
}

/**
 * The dialect of the shell tool that runs this input. The matcher wires Bash and PowerShell
 * only; an input that names neither is read as Bash, the tool the hook was born on.
 */
function inputDialect(input: HookInput): Dialect {
  return dialectOfTool(input.tool_name) ?? "bash";
}

/**
 * The hook: the judge first, then the route.
 *
 * A judged line answers the judge and goes no further: an ask or a denial is never combined
 * with a rewrite.
 *
 * **The rewrite is Bash only.** Their rewritten line is a Bash command
 * (`routedShell`), and the PowerShell tool cannot run one. So where the route is on, a heavy
 * PowerShell line is refused instead, naming the Bash tool (`powerShellDenial`) — but only where
 * the Bash tool exists (`bashTool`, Git Bash on Windows): with none, the line is left as written.
 * Any other PowerShell line is judged and otherwise left exactly as the model wrote it.
 */
export function jobRoute(
  context: HookContext,
  bashTool: (env: Env) => boolean = bashToolExists,
): HookResult {
  const fields = toolInput(context.input);
  const command = stringField(fields.command);
  if (command === null) return SILENT;
  const dialect = inputDialect(context.input);
  const verdict: BashVerdict | null = judgeBash(readBash(command, dialect), {
    env: context.env,
    input: context.input,
    paths: context.paths,
    startedAtMs: context.nowMs,
  });
  if (verdict !== null) return judgeAnswer(verdict);
  const kinds = mergeKinds(context.project.config?.jobs?.kinds);
  // The Bash tool's shell starts in the input's `cwd`; the classifier follows a `cd`.
  const source: ScriptSource = { folder: context.cwd, scriptsIn: packageScripts };
  if (dialect !== "bash") {
    if (!routesHeavyCommands(context)) return SILENT;
    // The Git Bash lookup reads files, so only a heavy line asks for it.
    const refused = powerShellDenial(command, kinds, source);
    return refused !== null && bashTool(context.env) ? refused : SILENT;
  }
  const routed = routesHeavyCommands(context)
    ? routeHeavyCommand(command, kinds, routedShell(context.env), source)
    : null;
  if (routed === null) return SILENT;
  return REWRITE_SUPPORTED ? rewriteAnswer(fields, routed.command) : routeDenial(routed);
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
  const dialect = inputDialect(input);
  // A heavy PowerShell line is refused where the route is on, so it is asked about here too —
  // unless there is no Bash tool to run it in, where it is left as written (`jobRoute`).
  if (
    command === null ||
    classifyHeavyCommand(command, mergeKinds(undefined), undefined, dialect) === null ||
    (dialect !== "bash" && !bashToolExists(context.env))
  ) {
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
  const dialect = inputDialect(input);
  if (judgedDomain(readBash(command, dialect))) return true;
  // A heavy line of either shell: the route rewrites a Bash one and may refuse a PowerShell one.
  return classifyHeavyCommand(command, mergeKinds(undefined), undefined, dialect) !== null;
}

/**
 * The facts for the hook log: what the judge read (its launches and decision) and
 * whether the line already runs `job run`, so `doctor --live` can prove both parts answered.
 */
export function routeFacts(input: HookInput, context: HookEnvContext): Record<string, unknown> {
  const command = commandOf(input);
  if (command === null) return {};
  const reading = readBash(command, inputDialect(input));
  const verdict = judgeBash(reading, {
    env: context.env,
    input,
    paths: context.paths,
    startedAtMs: context.nowMs,
  });
  const facts: Record<string, unknown> = { job_run: runsJobRun(command) };
  if (reading.launches.length > 0) facts.launches = reading.launches.map((one) => one.form);
  if (reading.workflowPropose) facts.workflow_propose = true;
  if (verdict !== null) {
    facts.decision = verdict.decision;
    facts.why = verdict.why;
  }
  return facts;
}
