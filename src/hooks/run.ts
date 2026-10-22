/**
 * The frame every hook runs in, in this order:
 *
 * 1. Read the input. Not a JSON object, a wrong event, or a `cwd` that is not a folder in
 *    git: nothing to do.
 * 2. **The project's own copy**: when the project's cc-smart-dev-kit.json lists the hook in
 *    `ownHooks`, exit 0 and print nothing, so the project's copy runs alone (a hook with
 *    `alwaysOn` skips this step: the project cannot switch it off). Only that field
 *    is read here (`ownHooksOf`), so it works even when the rest of the file is broken or
 *    needs a newer plugin. Nothing else silences a plugin hook: a project hook on the same
 *    event does not (it may be a logger, and a guard must not go quiet for it).
 * 3. Read the project's cc-smart-dev-kit.json. When it is broken or needs a newer plugin, the
 *    hook **fails closed** in its own way (`onConfigProblem`): a guard asks, an informational
 *    hook prints one line.
 * 4. Run the hook. A guard's own crash answers through `onCrash` (a guard asks about the
 *    call in its own domain, never a silent pass); an informational hook's crash is one line
 *    on stderr and exit 0 — a bug never stops a person's work. Claude Code holds the second
 *    belt: a guard's hooks.json entry carries `onFailure: "block"`, so a hook that cannot
 *    start, times out or answers nothing readable blocks the tool call.
 * 5. **Record an ask.** When the answer asks the person, the frame appends one line to
 *    `guard-asks.jsonl` in the state folder (`src/hooks/ask-log.ts`); a write that fails is
 *    one line on stderr and never changes the answer.
 *
 * A **machine-wide** hook (`agent-guard`, and the notifier) answers about the machine, not a
 * project: it runs with or without `cc-smart-dev-kit.json`, and its answer never depends on the
 * project's file. It gets the input and the environment (`HookEnvContext`) where the frame's
 * checkout or config step does not apply, and a project may still silence it through
 * `ownHooks` (which is read on its own, before the file).
 *
 * `CC_SMART_DEV_KIT_HOOK_LOG` (a file path), when set, gets one JSON line per hook run: what
 * `cc-smart-dev-kit doctor --live` reads to prove the hooks fired.
 */
import { appendFileSync } from "node:fs";
import { type CliPaths, cliPaths } from "../cli/paths";
import { maskedLine } from "../gateway/plain-text";
import { CcSmartDevKitConfigError } from "../project/config";
import {
  type Checkout,
  loadProjectConfig,
  locateCheckout,
  ownHooksOf,
  type Project,
} from "../project/resolve";
import { ASK_REASON_MAX, appendAsk, askLogFile } from "./ask-log";
import {
  askReason,
  type HookInput,
  type HookResult,
  parseHookInput,
  SILENT,
  stringField,
} from "./io";

export type Env = Record<string, string | undefined>;

/** The environment variable naming the file each hook run is logged to. */
export const HOOK_LOG_ENV = "CC_SMART_DEV_KIT_HOOK_LOG";

export interface HookContext {
  input: HookInput;
  event: string;
  /** The input's `cwd`: it follows the session into a worktree. */
  cwd: string;
  project: Project;
  env: Env;
  paths: CliPaths;
}

/**
 * What a hook gets besides the input when the frame's project steps do not apply (no
 * checkouts, a broken cc-smart-dev-kit.json, outside git): the environment and the paths. A
 * machine-wide hook (agent-guard) judges from these alone, so its answer does not change
 * with the project's file.
 */
export interface HookEnvContext {
  env: Env;
  paths: CliPaths;
}

export interface HookSpec {
  /** The bundle's name (`dist/<name>.js`), used in messages and the log. */
  name: string;
  /** The events it is wired for. Any other event: nothing to do. */
  events: string[];
  /**
   * The answer when cc-smart-dev-kit.json is broken or needs a newer plugin: fail closed.
   * `context` (the environment and paths): for a hook whose answer does not depend on the
   * project's file, so it can judge the same way (`agent-guard`).
   */
  onConfigProblem: (
    message: string,
    input: HookInput,
    event: string,
    checkout: Checkout,
    context: HookEnvContext,
  ) => HookResult;
  /** The answer when `cwd` is missing, not a folder, or outside git. Default: silent. */
  outsideGit?: (
    input: HookInput,
    event: string,
    why: string,
    context: HookEnvContext,
  ) => HookResult;
  /**
   * Facts for the hook log only (`CC_SMART_DEV_KIT_HOOK_LOG`), never part of the answer: what the
   * hook's own parser read in the input, and — where the answer is a judgement — what it
   * judged. `doctor --live` reads them to prove a guard read the call, not only that the
   * hook ran (`.claude/rules/hooks.md` § Quiet output). `context` (the environment and
   * paths) is there for a machine-wide hook, whose facts do not depend on the project.
   */
  logFacts?: (input: HookInput, context: HookEnvContext) => Record<string, unknown>;
  /**
   * The answer when the hook's own code throws. **A guard answers here, never with a
   * silent pass**: a crash must not let a call through, so the guard asks the person about
   * the call in its own domain. An informational hook leaves it out: its crash is one line
   * on stderr and exit 0, because a bug never stops a person's work.
   *
   * `why` is the error's message, `input` the hook's input (null when it could not be
   * read) and `event` the event it was for ("" when it could not be read). The answer must
   * fit the event: a PreToolUse guard asks, and on any other event it says nothing.
   */
  onCrash?: (
    why: string,
    input: HookInput | null,
    event: string,
    context: HookEnvContext,
  ) => HookResult;
  run: (context: HookContext) => HookResult | Promise<HookResult>;
  /**
   * True when the project cannot switch the hook off: the frame skips the `ownHooks` step, and
   * `ownHooks` does not accept the name (`PLUGIN_HOOK_NAMES`). For a guard that guards the
   * project's own file — a session could otherwise list the guard there first
   * (`session-escape-guard`).
   */
  alwaysOn?: boolean;
  /** The exit code when the hook itself fails. Default 0. */
  crashExitCode?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The answer when the hook's own code throws. A hook with `onCrash` answers through it (a
 * guard asks about the call in its own domain); a hook without it gets one line on stderr
 * and exit 0 — a bug never stops a person's work. An `onCrash` that throws itself gets the
 * same one line: the answer must never be worse than the line.
 */
function crashResult(
  spec: HookSpec,
  why: string,
  input: HookInput | null,
  event: string,
  context: HookEnvContext,
): HookResult {
  const line: HookResult = {
    exitCode: spec.crashExitCode ?? 0,
    stderr: `cc-smart-dev-kit ${spec.name}: ${why}`,
  };
  if (spec.onCrash === undefined) return line;
  try {
    return spec.onCrash(why, input, event, context);
  } catch {
    return line;
  }
}

/**
 * The record of an ask: one line in `guard-asks.jsonl` in the state folder
 * (`src/hooks/ask-log.ts`), for every answer of the frame that asks the person — from the
 * hook's `run`, its `onConfigProblem`, its `outsideGit` or its `onCrash`. A question is the
 * person's judgment, and "which guard asked, and about what" is worth keeping. The reason goes
 * through `maskedLine` first: a question often quotes the command, and the record never holds
 * a secret. A write that fails is one line on stderr and never changes the answer.
 */
function recordAsk(
  spec: HookSpec,
  input: HookInput | null,
  result: HookResult,
  context: HookEnvContext,
  nowMs: number,
): HookResult {
  const reason = askReason(result);
  if (reason === null) return result;
  try {
    appendAsk(askLogFile(context.paths.stateDir), {
      at: nowMs,
      hook: spec.name,
      session: stringField(input?.session_id) ?? "",
      tool: stringField(input?.tool_name) ?? "",
      reason: maskedLine(reason, [], ASK_REASON_MAX, { mark: "..." }),
    });
  } catch (error) {
    const note = `cc-smart-dev-kit ${spec.name}: the ask could not be recorded (${errorMessage(error)})`;
    return { ...result, stderr: result.stderr === undefined ? note : `${result.stderr}\n${note}` };
  }
  return result;
}

/** The frame's steps 1 to 4 (the file's header): the hook's answer. Never throws. */
async function answer(
  spec: HookSpec,
  input: HookInput | null,
  context: HookEnvContext,
): Promise<HookResult> {
  const { env } = context;
  let event = "";
  try {
    if (input === null) {
      // The frame cannot know the event, so a guard asks in general (`onCrash`) and any other
      // hook says one line. Claude Code always sends JSON: this is a broken caller.
      return crashResult(spec, "the hook input is not JSON", null, "", context);
    }
    const named = stringField(input.hook_event_name);
    if (named === null || !spec.events.includes(named)) return SILENT;
    event = named;
    const cwd = stringField(input.cwd);
    const outside = spec.outsideGit ?? (() => SILENT);
    if (cwd === null) return outside(input, event, "the hook input has no cwd", context);

    let checkout: Checkout | null;
    try {
      checkout = locateCheckout(cwd, { env });
    } catch (error) {
      return outside(input, event, errorMessage(error), context);
    }
    if (checkout === null) return outside(input, event, `${cwd} is not in a git checkout`, context);

    if (spec.alwaysOn !== true && ownHooksOf(checkout).includes(spec.name)) return SILENT;

    let project: Project;
    try {
      project = loadProjectConfig(checkout);
    } catch (error) {
      if (error instanceof CcSmartDevKitConfigError) {
        return spec.onConfigProblem(error.message, input, event, checkout, context);
      }
      throw error;
    }
    return await spec.run({ input, event, cwd, project, env, paths: context.paths });
  } catch (error) {
    return crashResult(spec, errorMessage(error), input, event, context);
  }
}

/**
 * Runs one hook on its input text: the answer of the frame's steps, then the record of an ask.
 * Never throws. `nowMs` is the time a recorded ask carries.
 */
export async function handleHook(
  spec: HookSpec,
  text: string,
  env: Env,
  nowMs: number = Date.now(),
): Promise<HookResult> {
  const context: HookEnvContext = { env, paths: cliPaths(env) };
  const input = parseHookInput(text);
  return recordAsk(spec, input, await answer(spec, input, context), context, nowMs);
}

/**
 * Appends one line to the hook log, when `CC_SMART_DEV_KIT_HOOK_LOG` names one. Never throws.
 * `facts`: what the spec's own parser read (`logFacts`), for `doctor --live`.
 */
function logRun(spec: HookSpec, text: string, result: HookResult, env: Env): void {
  const file = env[HOOK_LOG_ENV];
  if (file === undefined || file === "") return;
  try {
    const input = parseHookInput(text);
    const facts =
      input === null ? {} : (spec.logFacts?.(input, { env, paths: cliPaths(env) }) ?? {});
    appendFileSync(
      file,
      `${JSON.stringify({
        hook: spec.name,
        event: stringField(input?.hook_event_name),
        cwd: stringField(input?.cwd),
        exitCode: result.exitCode ?? 0,
        stdout: (result.stdout ?? "").slice(0, 2000),
        ...(Object.keys(facts).length === 0 ? {} : { facts }),
      })}\n`,
    );
  } catch {
    // The log is for a check; a hook never fails over it.
  }
}

/**
 * The body of `src/entries/<hook>.ts` and of `cc-smart-dev-kit hook <name>`: stdin in, the answer
 * out, then exit.
 */
export async function runHookEntry(spec: HookSpec): Promise<never> {
  const text = await Bun.stdin.text();
  const result = await handleHook(spec, text, process.env);
  logRun(spec, text, result, process.env);
  // Bun.write waits until the bytes are written, so the exit below cuts nothing off.
  if (result.stdout !== undefined) await Bun.write(Bun.stdout, result.stdout);
  if (result.stderr !== undefined) await Bun.write(Bun.stderr, `${result.stderr}\n`);
  process.exit(result.exitCode ?? 0);
}
