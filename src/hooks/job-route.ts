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
 * moves to), to tell a script from the tool of the same name and to read a script by its body:
 * a `tsc` script that already wraps the job is not wrapped a second time. **Only a heavy run is
 * routed** (`runWeight`): a run that names only files that exist, or only prints, starts at
 * once and is left raw; so is a watch run or a `--ui` run, which never ends and must not hold a
 * slot. A heavy command piped into read-only filters
 * (`tsc --noEmit 2>&1 | tail -20`, the list is `READ_ONLY_FILTERS`) is queued without them: the
 * filters stay after the queue's command, where the person's own Bash rules see them.
 *
 * **A mixed line** holds heavy work beside other commands, and the queue takes it whole only
 * when everything beside the heavy commands is harmless glue (`echo`, `printf`, a reader that
 * reads the pipe and names no file, the `{ … }` and `( … )` of a group; `GLUE_COMMANDS` and `isGlueCommand`):
 * `bun run check; echo "exit $?"` is queued as one line. Any other command beside heavy work
 * (`bun test; git status`) would be hidden from the person's `Bash(...)` rules inside the queue's
 * shell string, and run raw the heavy part would not wait for a slot: so the line is **refused**,
 * and the reason says to run the heavy command on its own line (`mixedLineDenial`). A run that
 * takes no slot (a light run, a watch run, a line that queues itself) is no mix.
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
 * The rewrite also gives a call that set no `timeout` the Bash tool's longest one
 * (`REWRITE_TIMEOUT_SUPPORTED`): a job may wait for a slot for many minutes.
 *
 * A command already inside `cc-smart-dev-kit job run` stays as it is (the queue would nest: the
 * classifier says so, through a script's body too), and anything the hook cannot read lets the
 * call through.
 *
 * **A git command whose hook is heavy** (`git commit`, `git merge`, `git push`; `routeGitHooks`)
 * is not wrapped, because the person's own deny and ask rules must still match the `git` line
 * (Claude Code reads past a leading variable assignment, not past a wrapper). It gets three
 * variable assignments in front instead, which point git at the kit's hooks folder for that one
 * command (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>=core.hooksPath`, `GIT_CONFIG_VALUE_<n>=<folder>`).
 * The scripts in that folder run the repo's own hook, inside the queue when it is heavy
 * (`src/jobs/hook-folder.ts`). Every other byte of the line stays as written. The prefix is
 * added only when all of these hold; any doubt leaves the line as it is, so no hook is ever
 * skipped:
 * - the route is on, and this is not native Windows (the scripts are `sh`);
 * - the kit's folder is whole and this version's own (`gitHooksState` says ok: its mark, a
 *   runnable script under every name, no stray file);
 * - the command is a plain `git` (only variable assignments before it), does not skip its hooks
 *   (`--no-verify`, a commit's `-n`; a push's `-n` is `--dry-run`), sets no `core.hooksPath` of
 *   its own (`-c`), and the line sets no `GIT_CONFIG_*` variable;
 * - the session's own environment does not already set `core.hooksPath` through `GIT_CONFIG_*`
 *   (the person chose a hooks folder), and when it holds other pairs (CI often sets a
 *   `safe.directory` one) the kit's pair is added after them: the count grows, nothing is lost;
 * - the hook that command would run (commit: `pre-commit` and `commit-msg`; merge:
 *   `pre-merge-commit` and `commit-msg`; push: `pre-push`) is heavy (`hookDecision`), read in
 *   the folder the command runs in (after a `cd`, and `git -C`);
 * - the command's place in the line is known exactly (`ShellStep.start`). One inside `bash -c '…'`,
 *   a backtick, a here-doc or a bash array's list (`cmd=(git push)`) is left as it is.
 *
 * With `git --git-dir` or `--work-tree`, `job hook` cannot find the repo (it asks git without
 * the `GIT_DIR` variable) and answers direct: the hook then runs as it is, unqueued, which is
 * safe. A line is never both routable and a git command: git is not a heavy kind, so a line
 * with a git command in it is never queued whole. A line that runs heavy work (that takes a
 * slot) beside a git command is refused as a mixed line, before the prefix is asked: the prefix
 * would leave that heavy run raw.
 */

import { existsSync } from "node:fs";
import { findGitBash, type GitBashFacts } from "../cli/git-bash";
import {
  classifyHeavyCommand,
  mixedHeavyLine,
  routableLine,
  runWeight,
  type WeightSource,
} from "../jobs/classify";
import { hookDecision } from "../jobs/git-hooks";
import { gitHooksState } from "../jobs/hook-folder";
import { type Kinds, mergeKinds } from "../jobs/kinds";
import { packageScripts } from "../jobs/package-scripts";
import { diskWeightSource } from "../jobs/weight-source";
import { LAUNCHER_IN_SHELL } from "../setup/launcher";
import { CHANGES_FOLDER, FolderTracker, movedTo } from "../shell/change-dir";
import {
  type Dialect,
  dialectOfTool,
  invocationOf,
  isAssignmentOnly,
  isShort,
  readingsOf,
  shellSegments,
  shellSteps,
  shortFlags,
  withoutRedirections,
  wordsOf,
  wordsWithFill,
} from "../shell/command";
import { gitCalls, longOption } from "../shell/git-calls";
import { programName } from "../shell/program-name";
import { shellQuote, shellWord } from "../shell/quote";
import { resolveJobRoute } from "../workflow/resolve";
import {
  type BashVerdict,
  commandOf,
  judgeAnswer,
  judgeBash,
  judgedDomain,
  readBash,
} from "./bash-judge";
import { SHORT_GUARD_BUDGET_MS, startBudget } from "./budget";
import { GUARD_GIT_TIMEOUT_MS } from "./git";
import {
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";
import type { Env, HookContext, HookEnvContext } from "./run";

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

/** The kind a command runs, and the queue command that would run it instead. */
export interface Routed {
  command: string;
  kind: string;
}

/**
 * The route for a heavy command, or null when there is nothing to route. Pure: `source` is the
 * folder the line runs in and the readers of its `package.json` and its files, so the
 * classifier tells a project's script from a tool of the same name, and the judge tells a run
 * on named files from a full run, without reading a file themselves.
 *
 * Two questions, and both must say yes. `routableLine` says the line may be queued (every
 * command in it is heavy, a `cd`, an assignment or glue, and one is heavy) and names its kind;
 * `runWeight` says it is heavy. A light run (it
 * names only files that exist, or only prints) starts at once, so it is never wrapped; a watch
 * run, a `--ui` run, or a line that queues itself (`weight: none`) must never hold a slot, so it
 * is never wrapped either. The kind is `routableLine`'s.
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
  source: WeightSource,
): null | Routed {
  const line = routableLine(command, kinds, source);
  if (line === null || runWeight(line.heavy, kinds, source).weight !== "heavy") return null;
  const queued = jobRunCommand(line.kind, line.heavy, shell);
  return {
    command: line.filters === "" ? queued : `${queued} ${line.filters}`,
    kind: line.kind,
  };
}

/** The hooks of a git command that the kit's folder may queue: the ones the command runs. */
const GIT_COMMAND_HOOKS: Readonly<Record<string, readonly string[]>> = {
  commit: ["pre-commit", "commit-msg"],
  merge: ["pre-merge-commit", "commit-msg"],
  push: ["pre-push"],
};

/** `git commit`'s short options that take a value: a letter after them is part of the value. */
const COMMIT_VALUED_SHORT = "cCFmtuS";

/**
 * True when the command's own arguments skip its hooks: `--no-verify` (git takes any unique
 * prefix, so every prefix of eight characters or more), and a commit's `-n`. A push's `-n` is
 * `--dry-run`, and a merge has no short one. Arguments after `--` are paths.
 */
function skipsHooks(sub: string, rest: readonly string[]): boolean {
  for (const arg of rest) {
    if (arg === "--") return false;
    if (longOption(arg, "--no-verify", 8)) return true;
    if (
      sub === "commit" &&
      isShort(arg) &&
      shortFlags(arg, COMMIT_VALUED_SHORT).flags.includes("n")
    )
      return true;
  }
  return false;
}

/** One git command of a line that runs a hook: where its first word is, and where it runs. */
interface GitHookStep {
  /** The offset of the command's first word in the line. */
  at: number;
  /** `commit`, `merge` or `push`. */
  sub: string;
  folder: string;
}

/**
 * The git commands of a Bash line that run a hook the route may queue, each placed exactly in
 * the line. A command is left out when it is anything but plain `git` (a wrapper, a keyword, a
 * redirection or a computed word before it), when git may read its subcommand in more than one
 * way, when it skips its hooks or sets `core.hooksPath` itself, when a word before the
 * subcommand is filled in by the shell (`git -C "$dir" push`), when a `cd` took the line
 * somewhere unknown, and when the line's own text at the command's offset is not the text the
 * reader cut out (`ShellStep.start`).
 */
function gitHookSteps(command: string, cwd: string): GitHookStep[] {
  const found: GitHookStep[] = [];
  const tracker = new FolderTracker(cwd);
  for (const step of shellSteps(command)) {
    const folder = tracker.enter(step.subshell);
    const words = wordsWithFill(step.text);
    const invocation = invocationOf(words.map((word) => word.text));
    if (invocation === undefined) continue;
    const { args, computed, prefix, program } = invocation;
    if (CHANGES_FOLDER.has(program)) {
      tracker.moveTo(movedTo(program, folder, withoutRedirections(args)));
    }
    if (program !== "git" || computed || step.start === undefined || folder === null) continue;
    // A bash array's list (`cmd=(git push)`) holds words: nothing may be put in front of them.
    if (step.subshell?.array === true) continue;
    if (prefix.length > 0 && !isAssignmentOnly(prefix)) continue;
    const calls = gitCalls(withoutRedirections(args));
    const call = calls.length === 1 ? calls[0] : undefined;
    if (call === undefined || GIT_COMMAND_HOOKS[call.sub] === undefined) continue;
    if (call.config.has("core.hookspath") || skipsHooks(call.sub, call.rest)) continue;
    if (words.slice(0, words.length - call.rest.length).some((word) => word.filled)) continue;
    // `-C dir` moves the command: its hooks are the hooks of the repo it lands in.
    let runsIn: string | null = folder;
    for (const dir of call.dirs) runsIn = runsIn === null ? null : movedTo("cd", runsIn, [dir]);
    if (runsIn === null) continue;
    // The reader cuts a here-doc body out of a `$( … )` word, so only the text before the first
    // line break must match the line; and what it cut must be at this offset, or the line stays.
    const lead = step.text.split("\n")[0] ?? "";
    if (!command.startsWith(lead, step.start)) continue;
    const blanks = /^[ \t]*/.exec(step.text)?.[0].length ?? 0;
    found.push({ at: step.start + blanks, folder: runsIn, sub: call.sub });
  }
  return found;
}

/**
 * The number the kit's `core.hooksPath` pair takes in the `GIT_CONFIG_*` list of the session's
 * own environment (its count: unset is zero, so the pair is number 0), or null when the line
 * must get no pair: the count is not a plain whole number, or a pair of the environment already
 * sets `core.hooksPath` (a person's own hooks folder for this session).
 */
function hooksPairNumber(env: Env): number | null {
  const given = env.GIT_CONFIG_COUNT;
  if (given === undefined) return 0;
  if (!/^(0|[1-9]\d*)$/.test(given) || !Number.isSafeInteger(Number(given) + 1)) return null;
  const count = Number(given);
  for (const [name, value] of Object.entries(env)) {
    const number = /^GIT_CONFIG_KEY_(\d+)$/.exec(name)?.[1];
    if (
      number !== undefined &&
      Number(number) < count &&
      value?.toLowerCase() === "core.hookspath"
    ) {
      return null;
    }
  }
  return count;
}

/**
 * The line with the kit's hooks-folder prefix in front of each git command whose hook is heavy
 * (the header of this file says when), and the kind of the first such hook; null when no
 * command gets one. Every other byte of the line is as written. `platform` is a test's.
 */
export function routeGitHooks(
  command: string,
  context: HookContext,
  kinds: Kinds,
  platform: NodeJS.Platform = process.platform,
): null | Routed {
  // The scripts are `sh`; and a line that sets `GIT_CONFIG_*` itself, or continues past an escaped
  // line break (read two ways, so a `--no-verify` could hide), is left as it is.
  if (platform === "win32" || command.includes("GIT_CONFIG_")) return null;
  if (readingsOf(command, "bash").length > 1) return null;
  const pair = hooksPairNumber(context.env);
  if (pair === null) return null;
  const steps = gitHookSteps(command, context.cwd);
  const folder = context.paths.gitHooksFolder;
  // Only a folder `setup` wrote whole, in this version's text, with every name runnable: git
  // skips a hook that is not executable, so a broken folder would skip the person's own hook.
  if (steps.length === 0 || gitHooksState(context.paths).kind !== "ok") return null;
  const { timeFor } = startBudget(context.env, Date.now, SHORT_GUARD_BUDGET_MS, context.nowMs);
  // One answer per folder and hook, whatever the number of commands; every git call takes the
  // smaller of its own limit and the time left, and `timed-out` (no answer) queues nothing.
  const answers = new Map<string, ReturnType<typeof hookDecision>>();
  const queued: { at: number; kind: string }[] = [];
  for (const step of steps) {
    for (const name of GIT_COMMAND_HOOKS[step.sub] ?? []) {
      const key = `${step.folder}\0${name}`;
      let answer = answers.get(key);
      if (answer === undefined) {
        answer = hookDecision(
          name,
          step.folder,
          kinds,
          packageScripts,
          context.env,
          timeFor(GUARD_GIT_TIMEOUT_MS),
        );
        answers.set(key, answer);
      }
      if (typeof answer === "object") {
        queued.push({ at: step.at, kind: answer.queue });
        break;
      }
    }
  }
  const first = queued[0];
  if (first === undefined) return null;
  const prefix = [
    `GIT_CONFIG_COUNT=${pair + 1}`,
    `GIT_CONFIG_KEY_${pair}=core.hooksPath`,
    `GIT_CONFIG_VALUE_${pair}=${shellWord(folder)}`,
  ].join(" ");
  // From the last offset to the first, so an earlier offset is still where it was. The reader
  // lists the commands of a substitution before the command that holds it, so the order of
  // `queued` is not the order in the line.
  let routed = command;
  for (const { at } of queued.toSorted((one, other) => other.at - one.at)) {
    routed = `${routed.slice(0, at)}${prefix} ${routed.slice(at)}`;
  }
  return { command: routed, kind: first.kind };
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
 * Does this Claude Code take a `timeout` in `updatedInput`? Proved live on 2.1.326 (fake
 * Anthropic server, throwaway HOME): a PreToolUse hook's `updatedInput.timeout` cut `sleep 6`
 * at 2 s ("Command timed out after 2s") and raised a 1000 ms call to 10000, so `sleep 3; echo
 * done` printed `done`. A routed job may wait for a slot for many minutes, so the rewrite gives
 * a call that set no timeout the Bash tool's longest one. If a version ignores it, flip this to
 * false: the rewrite then carries the call's own timeout and nothing else.
 */
export const REWRITE_TIMEOUT_SUPPORTED = true;

/**
 * The Bash tool's own limits, from Claude Code's docs (https://code.claude.com/docs/en/env-vars):
 * `BASH_MAX_TIMEOUT_MS` is the longest timeout the model can set for a foreground command
 * (default 600000, ten minutes) and `BASH_DEFAULT_TIMEOUT_MS` the timeout a call gets when it
 * sets none (default 120000, two minutes). "The effective ceiling is the larger of" the two.
 */
export const DEFAULT_BASH_MAX_TIMEOUT_MS = 600_000;
export const DEFAULT_BASH_TIMEOUT_MS = 120_000;

/** A limit from the environment: a positive whole number of milliseconds, else the default. */
function limitFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

/**
 * The timeout a routed call gets when it set none: the Bash tool's effective ceiling in this
 * environment (`context.env`, which holds the variables Claude Code runs with). Never shorter
 * than the call would have had on its own.
 */
export function routedTimeoutMs(env: Env): number {
  return Math.max(
    limitFromEnv(env.BASH_MAX_TIMEOUT_MS, DEFAULT_BASH_MAX_TIMEOUT_MS),
    limitFromEnv(env.BASH_DEFAULT_TIMEOUT_MS, DEFAULT_BASH_TIMEOUT_MS),
  );
}

/**
 * The answer that makes the call run `command` instead: the same tool input, its `command`
 * replaced, and, given a `timeoutMs` ceiling, its `timeout` raised to it when the call set none.
 * A timeout the call chose is kept, and a call sent to the background (`run_in_background`) is
 * left alone: it has its own limit. **No `permissionDecision`**: the hook replaces the input
 * and the permission system still decides about the rewritten command, so a person's own deny
 * or ask rule for Bash is not overridden by the rewrite (proved live on 2.1.301: without a
 * decision Claude Code ran the rewritten command).
 */
export function rewriteAnswer(
  fields: Record<string, unknown>,
  command: string,
  timeoutMs: number | null = null,
): HookResult {
  const timeout =
    timeoutMs !== null && fields.timeout === undefined && fields.run_in_background !== true
      ? { timeout: timeoutMs }
      : {};
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...fields, command, ...timeout },
      },
    }),
  };
}

/**
 * The kind of the heavy run a line makes, as the queue would weigh it, or null: no heavy
 * command, or one that needs no slot (a light run, a watch run, a line that queues itself).
 * `source` null (the folder is not known): the line is judged by its kind alone. A PowerShell
 * line is weighed through its Bash form (`bashLineOf`); one that has none cannot be weighed, and
 * is heavy by its kind, as it was before the judge.
 */
function heavyRunKind(
  command: string,
  kinds: Kinds,
  source: WeightSource | null,
  dialect: Dialect,
): string | null {
  const kind = classifyHeavyCommand(command, kinds, source ?? undefined, dialect);
  if (kind === null || source === null) return kind;
  const bash = dialect === "bash" ? command : bashLineOf(command);
  if (bash === null) return kind;
  return runWeight(bash, kinds, source).weight === "heavy" ? kind : null;
}

/** The disk the judge reads for a line that runs in the input's `cwd`; null when it names none. */
function weightSourceOf(input: HookInput): WeightSource | null {
  const cwd = stringField(input.cwd);
  return cwd === null ? null : diskWeightSource(cwd);
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
 * which the Bash tool then queues. Null when the line runs nothing heavy: a print-only run
 * (`tsc --version`), a run on files that exist (`bun test ./a.test.ts`), a watch run, or a line
 * that queues itself (`heavyRunKind`) needs no slot, so there is nothing to refuse.
 */
export function powerShellDenial(
  command: string,
  kinds: Kinds,
  source: WeightSource,
): HookResult | null {
  const kind = heavyRunKind(command, kinds, source, "powershell");
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

/** The longest piece of the person's line a refusal quotes. */
const QUOTED_MAX = 120;

/** A command's text for a reason: on one line, and cut with `…` when it is long. */
function quoted(text: string): string {
  const line = text.replace(/\s+/g, " ");
  return line.length <= QUOTED_MAX ? line : `${line.slice(0, QUOTED_MAX)}…`;
}

/**
 * The refusal of a Bash line that runs heavy work beside commands that are not glue
 * (`mixedHeavyLine`, `src/jobs/classify.ts`), or null when the line is no such mix. The queue
 * takes a line whole only when every command in it is heavy or harmless glue, so that the
 * person's own `Bash(...)` deny and ask rules, matched against the words of the command Claude
 * Code runs, are never hidden inside the queue's shell string. Run raw, the heavy part would
 * not wait for a slot. So the line is refused, and the reason says how to split it: the heavy
 * command alone (it may keep a `cd`, a redirection, a pipe into a read-only filter, and glue
 * around it) is queued, and the rest goes in a separate call.
 *
 * A light run, a watch run, a line that queues itself, and a line whose failing command sits in
 * a package script's body (which a person cannot split) are no mix: null, and the line runs as
 * it did. The caller asks this only when the route gave no queue command for the line.
 */
export function mixedLineDenial(
  command: string,
  kinds: Kinds,
  source: WeightSource,
): HookResult | null {
  const mixed = mixedHeavyLine(command, kinds, source);
  if (mixed === null) return null;
  return toolDecision(
    "deny",
    [
      `This line runs heavy work (${mixed.run === null ? mixed.kind : `${mixed.kind}: ${quoted(mixed.run)}`}) beside other commands (${quoted(mixed.other)}). The job queue cannot take the whole line without hiding those commands from your permission rules, and run raw the heavy part would not wait for a free slot; many heavy runs at once have run machines out of memory.`,
      "Run the heavy command on its own line, where it waits for a slot in the queue: it may keep a cd before it, a redirection, a pipe into tail, head or grep, and echo or printf around it, all with plain words (a word the shell fills in, such as $VAR or $(…), is refused). Then run the other commands in a separate call.",
    ].join("\n"),
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
 * **A Bash line** is, in this order: queued whole (`routeHeavyCommand`), refused when it mixes
 * heavy work with commands that are not glue (`mixedLineDenial`), or given the hooks prefix for
 * a git command whose hook is heavy (`routeGitHooks`). A refusal is a deny whoever is away: the
 * session reads the fix and retries, so nothing is parked.
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
  platform: NodeJS.Platform = process.platform,
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
  const source = diskWeightSource(context.cwd);
  if (dialect !== "bash") {
    if (!routesHeavyCommands(context)) return SILENT;
    // The Git Bash lookup reads files, so only a heavy line asks for it.
    const refused = powerShellDenial(command, kinds, source);
    return refused !== null && bashTool(context.env) ? refused : SILENT;
  }
  if (!routesHeavyCommands(context)) return SILENT;
  // A line is queued whole (every command heavy or glue) or refused (heavy work beside any other
  // command, `mixedLineDenial`) or has a git command whose hook is heavy; never two of them,
  // because git is no heavy kind and a line with one is no queued line. So each is asked only
  // when the one before it gave nothing: the refusal before the hooks prefix, which would
  // otherwise leave a raw heavy run beside the git command.
  let routed = routeHeavyCommand(command, kinds, routedShell(context.env), source);
  if (routed === null) {
    const refused = mixedLineDenial(command, kinds, source);
    if (refused !== null) return refused;
    routed = routeGitHooks(command, context, kinds, platform);
  }
  if (routed === null) return SILENT;
  if (!REWRITE_SUPPORTED) return routeDenial(routed);
  const timeoutMs = REWRITE_TIMEOUT_SUPPORTED ? routedTimeoutMs(context.env) : null;
  return rewriteAnswer(fields, routed.command, timeoutMs);
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
  // unless there is no Bash tool to run it in, where it is left as written (`jobRoute`). A light
  // run is neither routed nor refused, so it is not asked about either.
  if (
    command === null ||
    heavyRunKind(command, mergeKinds(undefined), weightSourceOf(input), dialect) === null ||
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

/**
 * True when a crash must ask: the line is judged, or a heavy command by the default kinds. A
 * light run is outside it: the route would have left it raw. A check that throws is a yes
 * (`guardCrash`), so a line this cannot read still asks.
 */
export function jobRouteDomain(input: HookInput): boolean {
  const command = commandOf(input);
  if (command === null) return false;
  const dialect = inputDialect(input);
  if (judgedDomain(readBash(command, dialect))) return true;
  // A heavy line of either shell: the route rewrites a Bash one and may refuse a PowerShell one.
  return heavyRunKind(command, mergeKinds(undefined), weightSourceOf(input), dialect) !== null;
}

/**
 * The facts for the hook log: what the judge read (its launches and decision) and, for a Bash
 * line run in a known folder, how the queue weighs it (light, heavy or none), so `doctor --live`
 * can prove both parts answered.
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
  const facts: Record<string, unknown> = {};
  const source = weightSourceOf(input);
  if (source !== null && inputDialect(input) === "bash") {
    facts.weight = runWeight(command, mergeKinds(undefined), source).weight;
  }
  if (reading.launches.length > 0) facts.launches = reading.launches.map((one) => one.form);
  if (reading.workflowPropose) facts.workflow_propose = true;
  if (verdict !== null) {
    facts.decision = verdict.decision;
    facts.why = verdict.why;
  }
  return facts;
}
