/**
 * The hooks hold the line while the person cannot answer (`src/user-away/state.ts` says whether
 * they can). A session that stops to ask, or waits on a permission prompt, only stops: nobody
 * reads it. So while the person is away this hook turns every wait into a denial that says what
 * to do instead — park it for the person and go on (`cc-smart-dev-kit user park`) — and keeps the
 * list the person goes through when they are back.
 *
 * Four answers, one state file, **never looser than before**: each is a deny where there was a
 * question, never an allow.
 *
 * - **PreToolUse on `AskUserQuestion` and `ExitPlanMode`**: denied, with the step that parks the
 *   question (or the plan awaiting approval). Nothing is parked here: the session parks the
 *   question itself, in its own words, or takes the choice and parks it as a decision.
 * - **Claude Code's own permission prompt (`PermissionRequest`)**: denied with a message, and the
 *   call parked as an `action` with its exact command, so the person's later yes can run it. One
 *   exception, the way back: a line that is nothing but the kit's own `user available`, `user
 *   status` or `user list` (`isStateCommand`) gets silence, so the person who is back answers
 *   Claude Code's prompt. Never in a crew session, which never asks the person.
 * - **A kit guard that would ask** (`askedWhileAway`, called by the frame for every hook): the
 *   ask becomes a deny that keeps the guard's own words, and the call is parked the same way.
 *   One home for all the guards, so a new guard needs nothing here.
 * - **UserPromptSubmit**: one short note to Claude, said once per change — the state, the
 *   expected return or the number of parked items — and again, in its own words, at the person's
 *   own prompt, which never switches the state back by itself (it may be one line from a phone).
 *   A session that heard "unavailable" is told once that the person is available again.
 *
 * **A state it cannot read changes nothing.** A broken state file is one line on stderr and the
 * answer the hook would have given without this feature: the question or the ask goes to the
 * person as it always did. A park that fails (a full list, a lock held too long) still denies,
 * and the deny says to park it by hand: the person is away, so the call must not wait.
 *
 * What it cannot reach: a project's own copy of a guard (`ownHooks`) answers in Claude Code
 * directly, and the shim's `--missing=ask` (no bun at all) cannot read any state. Claude Code's own
 * prompt for such a call is the `PermissionRequest` answer above.
 */

import { COMMAND } from "../build-info/names";
import type { CliPaths } from "../cli/paths";
import { CREW_QUESTION_STEP, crewIdOf } from "../crew/session";
import { formatClock } from "../gateway/limit-state";
import { maskedLine } from "../gateway/plain-text";
import {
  dialectOfTool,
  invocationOf,
  shellSteps,
  withoutRedirections,
  wordsOf,
} from "../shell/command";
import {
  type AwayState,
  AwayStateError,
  forgetSaid,
  type ParkedItem,
  parkItem,
  readAway,
  sayOnce,
} from "../user-away/state";
import { type OwnerSources, ownedItems, waitingLines } from "../user-away/whose";
import {
  AVAILABLE_SKILL,
  COMMAND_MAX,
  plural,
  TEXT_MAX,
  UNAVAILABLE_SKILL,
} from "../user-away/words";
import { BUDGET_MARGIN_MS, SHORT_GUARD_BUDGET_MS, startBudget } from "./budget";
import {
  addContext,
  askReason,
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
  toolInput,
} from "./io";
import { hasNotPersonWrapper } from "./prompt-source";
import type { Env } from "./run";

/**
 * How long a park waits for the state's lock: half of what a guard keeps back for its answer
 * (`BUDGET_MARGIN_MS`). A guard that ran on its budget (`src/hooks/budget.ts`: 8 s of its 10 s,
 * 25 s of 30 s) and then waited the full `AWAY_LOCK_WAIT_MS` (5 s) would pass its hook's
 * `timeout`, and Claude Code, killing it, blocks the call with no word to the session
 * (`onFailure: block`). A lock held longer is a park that failed, which still denies and says to
 * park by hand.
 */
const PARK_WAIT_MS = BUDGET_MARGIN_MS / 2;

/** The two tools that put a question to the person: each waits for an answer nobody reads. */
export const AWAY_ASK_TOOLS = ["AskUserQuestion", "ExitPlanMode"] as const;

/** The shell tools: their `command` is what a parked action runs. */
const SHELL_TOOLS: readonly string[] = ["Bash", "PowerShell"];

/**
 * The kit's own commands that read or end the away state, as the arguments after the kit's name.
 * The person who is back runs them through the `user-available` skill, and Claude Code raises its
 * own prompt for each one: that prompt is the person's to answer, never parked. Nothing else
 * is on the list, flags included.
 */
const STATE_COMMANDS: readonly (readonly string[])[] = [
  ["user", "available"],
  ["user", "status"],
  ["user", "status", "--json"],
  ["user", "list"],
  ["user", "list", "--json"],
];

/** The longest piece of a guard's own words a parked item keeps. */
const REASON_MAX = 600;

/** What a test hands in; production leaves it out. */
export interface AwayOptions {
  /** The zone the times show in; undefined: the machine's. */
  timeZone?: string;
  /** Where whose an item is gets read from (`src/user-away/whose.ts`); the tests hand in their own. */
  owners?: OwnerSources;
}

/** True for the calls this hook judges on PreToolUse: the two that ask the person. */
export function inAwayDomain(input: HookInput): boolean {
  const tool = stringField(input.tool_name);
  return tool !== null && (AWAY_ASK_TOOLS as readonly string[]).includes(tool);
}

/** ` since 01:00, back about 07:00` — what the state says about the time. */
function whenText(state: AwayState, nowMs: number, options: AwayOptions): string {
  const clock = (iso: string) => {
    const at = Date.parse(iso);
    return Number.isNaN(at) ? iso : formatClock(at / 1000, nowMs, options.timeZone);
  };
  const from = state.since === null ? "" : ` since ${clock(state.since)}`;
  const back = state.until === null ? "" : `, back about ${clock(state.until)}`;
  return `${from}${back}`;
}

/** The one stderr line of a state the hook cannot read: nothing else about its answer changes. */
function stateLine(error: AwayStateError): string {
  return `cc-smart-dev-kit user-away: ${error.message}`;
}

/** The step a denied `AskUserQuestion` reads. */
function questionStep(when: string): string {
  return `The person is unavailable${when}: do not wait for an answer. Park the question with \`${COMMAND} user park --kind question "<the question>" --option "<choice>" --option "<choice>" --recommend <n>\` and go on with whatever it does not block. A choice that is easy to undo, with a recommended option in the plan, you take yourself and park as \`--kind decision\`. The rules: ${UNAVAILABLE_SKILL}.`;
}

/** The step a denied `ExitPlanMode` reads: the plan waits for approval like any question. */
function planStep(when: string): string {
  return `The person is unavailable${when}: the plan cannot be approved now. Park it with \`${COMMAND} user park --kind question "Approve the plan: <where it is, in one line>" --option "approve" --option "change it" --recommend 1\`, and go on with what needs no approval: reading, research, notes. The rules: ${UNAVAILABLE_SKILL}.`;
}

/**
 * What a denied question tool reads. A crew session reads its own step (its lead takes the
 * question, and the lead parks what is the person's); `crew-role` denies the same call with the
 * same step, so the two reasons agree. Any other session parks the question itself.
 */
function questionToolStep(tool: string, when: string, env: Env): string {
  if (crewIdOf(env) !== null) return CREW_QUESTION_STEP;
  return tool === "ExitPlanMode" ? planStep(when) : questionStep(when);
}

/** What a denied call reads once it is parked: its number, and that it waits for the yes. */
function parkedStep(when: string, item: ParkedItem): string {
  return `The person is unavailable${when}, so this was not asked: it is parked as #${String(item.id)}, an action that waits for their yes. Do not run it another way; go on with work that does not need it. The rules: ${UNAVAILABLE_SKILL}.`;
}

/** What a denied call reads when it could not be parked: park it by hand. */
function notParkedStep(when: string, why: string): string {
  return `The person is unavailable${when}, so this was not asked, and it could not be parked (${why}): park it by hand with \`${COMMAND} user park --kind action "<what>" --command "<command>"\`, then go on with work that does not need it. The rules: ${UNAVAILABLE_SKILL}.`;
}

/** The fields that name what a call works on, in the order a person would look for them. */
const TARGET_FIELDS = ["file_path", "notebook_path", "to", "url", "path", "pattern", "query"];

/** The longest piece of a call's other arguments a parked item keeps. */
const DETAIL_MAX = 300;

/**
 * The tool and what it works on: `Bash`, `Write /etc/hosts {"content":"…"}`, `WebFetch
 * https://example.com {"prompt":"…"}`. A shell call is its `command`, kept whole on the item, so
 * its label is the tool alone. Any other call keeps its target and a short, masked piece of its
 * other arguments: two calls of one tool at different targets are two things for the person to
 * answer, and the item says which is which.
 */
function callLabel(input: HookInput): string {
  const tool = stringField(input.tool_name) ?? "a tool";
  if (SHELL_TOOLS.includes(tool)) return tool;
  const args = toolInput(input);
  const field = TARGET_FIELDS.find((name) => stringField(args[name]) !== null);
  // A target may carry a secret too (a URL with a token in its query), so it is masked like the rest.
  const target =
    field === undefined ? null : maskedLine(stringField(args[field]) ?? "", [], DETAIL_MAX);
  const rest = Object.fromEntries(Object.entries(args).filter(([name]) => name !== field));
  const detail =
    Object.keys(rest).length === 0 ? "" : ` ${maskedLine(JSON.stringify(rest), [], DETAIL_MAX)}`;
  return `${tool}${target === null ? "" : ` ${target}`}${detail}`;
}

/** The exact command of a shell call; null for any other tool. */
function callCommand(input: HookInput): null | string {
  const tool = stringField(input.tool_name);
  if (tool === null || !SHELL_TOOLS.includes(tool)) return null;
  return stringField(toolInput(input).command);
}

/**
 * Parks the call as an action, with `words` saying what made it wait (a guard's question, or
 * Claude Code's own prompt). Returns the item, or why it could not be parked — never throws: a
 * call that waits for the person must be denied whatever happened to the list.
 */
async function parkCall(
  input: HookInput,
  env: Env,
  paths: CliPaths,
  nowMs: number,
  words: string,
): Promise<{ item: ParkedItem; ok: true } | { ok: false; why: string }> {
  const full = callCommand(input);
  const cut = full !== null && full.length > COMMAND_MAX;
  const command = cut ? full.slice(0, COMMAND_MAX) : full;
  const text = `${words}${cut ? ` The command was cut at ${String(COMMAND_MAX)} characters.` : ""}`;
  try {
    const { item } = await parkItem(
      paths.stateDir,
      {
        command,
        crew: crewIdOf(env) ?? "",
        cwd: stringField(input.cwd) ?? "",
        kind: "action",
        options: [],
        recommend: null,
        session: stringField(input.session_id) ?? "",
        text: text.slice(0, TEXT_MAX),
        tool: stringField(input.tool_name),
      },
      nowMs,
      PARK_WAIT_MS,
    );
    return { item, ok: true };
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * True when a shell call is nothing but the kit's own `user available`, `user status` or
 * `user list`: every command of the line, read with the one shell reader (`shellSteps`,
 * `invocationOf`), and the program is the kit's own command by name. **Not `kitArguments`**
 * (`kit-invocation.ts`): it leans toward yes on purpose, for guards that ask or deny, and reads
 * the words after a kit word in *any* program's arguments (`bash -c '…' cc-smart-dev-kit user
 * available`) as the kit's. An allow-list needs the opposite lean. A second command, a
 * substitution, a redirection, a prefix (`FOO=1`, `sudo`), a computed program, another
 * program, an argument off the list, or a line that does not parse is any other call. A line
 * the hook cannot be sure of is parked, as before: this only ever leaves a prompt alone for the
 * person to answer. (A file of another folder that is named like the kit passes too: the name is
 * what is read, and the feature stops mistakes, not a session set on getting past it.)
 */
function isStateCommand(input: HookInput): boolean {
  const command = callCommand(input);
  if (command === null) return false;
  const dialect = dialectOfTool(input.tool_name) ?? "bash";
  const steps = shellSteps(command, { blindWhenOpen: true, dialect, joinLines: true });
  if (steps.length === 0) return false;
  return steps.every((step) => {
    const invocation = invocationOf(wordsOf(step.text, dialect));
    if (invocation === undefined || invocation.computed || invocation.prefix.length > 0) {
      return false;
    }
    if (invocation.program !== COMMAND) return false;
    const operands = invocation.args;
    if (withoutRedirections(operands).length !== operands.length) return false;
    return STATE_COMMANDS.some(
      (known) =>
        known.length === operands.length && known.every((word, at) => word === operands[at]),
    );
  });
}

/** The deny (or the parked action) a `PermissionRequest` gets while the person is away. */
function permissionDeny(message: string): HookResult {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message },
      },
    }),
  };
}

async function permissionAnswer(
  input: HookInput,
  env: Env,
  paths: CliPaths,
  nowMs: number,
  options: AwayOptions,
): Promise<HookResult> {
  const state = readAway(paths.stateDir);
  if (!state.unavailable) return SILENT;
  // The kit's own switch-back and reads: the person who is back answers Claude Code's prompt,
  // as before this feature. Parking them would deny the one command that ends the state. A crew
  // session never asks the person, so it keeps the deny and the park under its name.
  if (crewIdOf(env) === null && isStateCommand(input)) return SILENT;
  const when = whenText(state, nowMs, options);
  const tool = stringField(input.tool_name) ?? "";
  // The two tools that ask are denied by their PreToolUse answer first; Claude Code's prompt for
  // one, if it ever gets here, reads the same step and parks nothing: the session parks it.
  if ((AWAY_ASK_TOOLS as readonly string[]).includes(tool)) {
    return permissionDeny(questionToolStep(tool, when, env));
  }
  const parked = await parkCall(
    input,
    env,
    paths,
    nowMs,
    `Claude Code's own permission prompt: ${callLabel(input)}`,
  );
  if (parked.ok) return permissionDeny(parkedStep(when, parked.item));
  return {
    ...permissionDeny(notParkedStep(when, parked.why)),
    stderr: `cc-smart-dev-kit user-away: could not park: ${parked.why}`,
  };
}

/** True when the prompt is the person's own words: a bare prompt in a session that is no crew session's. */
function isPersonsPrompt(input: HookInput, env: Env): boolean {
  if (crewIdOf(env) !== null) return false;
  const prompt = stringField(input.prompt);
  return prompt !== null && !hasNotPersonWrapper(prompt);
}

function parkedText(count: number): string {
  if (count === 0) return "Nothing is parked yet.";
  return `${plural(count, "item is", "items are")} parked.`;
}

async function noteAnswer(
  input: HookInput,
  env: Env,
  paths: CliPaths,
  nowMs: number,
  options: AwayOptions,
): Promise<HookResult> {
  const session = stringField(input.session_id);
  if (session === null) return SILENT;
  const state = readAway(paths.stateDir);
  const count = state.items.length;
  if (!state.unavailable) {
    // The state is back: a session that heard "unavailable" hears that it is over, once, with
    // what is its own to go through: the other sessions' items are theirs (`whose.ts`).
    if (!(await forgetSaid(paths.stateDir, session))) return SILENT;
    // Its git calls share the hook's 10 s, counted from the hook's start (the frame's `nowMs`),
    // so a wait for the state's lock above counts too: a call that would not fit is not made,
    // and the item's project is then unknown, which never makes it this session's.
    const { timeFor } = startBudget(env, Date.now, SHORT_GUARD_BUDGET_MS, nowMs);
    const asker = { session, cwd: stringField(input.cwd) ?? "", env, paths, timeFor };
    const left =
      count === 0
        ? "Nothing is left parked."
        : waitingLines(ownedItems(state.items, asker, options.owners)).join(" ");
    return addContext(
      "UserPromptSubmit",
      `The person is available again: ask your questions as usual. ${left}`,
    );
  }
  const when = whenText(state, nowMs, options);
  const first = await sayOnce(paths.stateDir, session, `${state.since}|${state.until}|${count}`);
  if (isPersonsPrompt(input, env)) {
    const waiting =
      count === 0
        ? "Nothing is parked yet."
        : `${plural(count, "item waits", "items wait")} for ${AVAILABLE_SKILL}.`;
    return addContext(
      "UserPromptSubmit",
      `The person wrote, and is still marked unavailable${when}: a message does not switch it back (it may come from a phone). Do what it asks, and keep following ${UNAVAILABLE_SKILL}. ${waiting}`,
    );
  }
  if (!first) return SILENT;
  return addContext(
    "UserPromptSubmit",
    `The person is unavailable${when}. Follow ${UNAVAILABLE_SKILL}: park what needs them, go on with the rest. ${parkedText(count)}`,
  );
}

/**
 * The hook's own answers, by event. A state it cannot read is one line on stderr and no change
 * to what the hook would have answered without the state.
 */
export async function userAwayAnswer(
  input: HookInput,
  event: string,
  env: Env,
  paths: CliPaths,
  nowMs: number,
  options: AwayOptions = {},
): Promise<HookResult> {
  try {
    if (event === "PreToolUse") {
      const tool = stringField(input.tool_name);
      if (tool === null || !(AWAY_ASK_TOOLS as readonly string[]).includes(tool)) return SILENT;
      const state = readAway(paths.stateDir);
      if (!state.unavailable) return SILENT;
      return toolDecision("deny", questionToolStep(tool, whenText(state, nowMs, options), env));
    }
    if (event === "PermissionRequest")
      return await permissionAnswer(input, env, paths, nowMs, options);
    if (event === "UserPromptSubmit") return await noteAnswer(input, env, paths, nowMs, options);
    return SILENT;
  } catch (error) {
    if (error instanceof AwayStateError) return { stderr: stateLine(error) };
    throw error;
  }
}

/**
 * The frame's one step for every hook: an answer that asks the person becomes a deny while the
 * person is away, naming the guard's own question, with the call parked as an action. Anything
 * that is not a PreToolUse ask — a deny, an allow, silence — comes back as it was, so this can
 * only ever make an answer stricter. A state it cannot read keeps the ask, with one line why.
 */
export async function askedWhileAway(
  input: HookInput | null,
  result: HookResult,
  env: Env,
  paths: CliPaths,
  nowMs: number,
  options: AwayOptions = {},
): Promise<HookResult> {
  const reason = askReason(result);
  if (reason === null || input === null) return result;
  if (stringField(input.hook_event_name) !== "PreToolUse") return result;
  let state: AwayState;
  try {
    state = readAway(paths.stateDir);
  } catch (error) {
    if (error instanceof AwayStateError) return { ...result, stderr: stateLine(error) };
    throw error;
  }
  if (!state.unavailable) return result;
  const when = whenText(state, nowMs, options);
  const parked = await parkCall(
    input,
    env,
    paths,
    nowMs,
    `${callLabel(input)}: ${maskedLine(reason, [], REASON_MAX)}`,
  );
  const lead = reason === "" ? "" : `${reason}\n\n`;
  if (parked.ok) return toolDecision("deny", `${lead}${parkedStep(when, parked.item)}`);
  return {
    ...toolDecision("deny", `${lead}${notParkedStep(when, parked.why)}`),
    stderr: `cc-smart-dev-kit user-away: could not park: ${parked.why}`,
  };
}
