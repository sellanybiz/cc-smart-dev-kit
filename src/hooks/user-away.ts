/**
 * The hooks hold the line while the person cannot answer (`src/user-away/state.ts` says whether
 * they can). A session that stops to ask only stops: nobody reads it. So while the person is away
 * this hook refuses the two tools that ask, and says what to do instead: take the recommended
 * option, keep working, and record the choice as a decision (`cc-smart-dev-kit user park --kind
 * decision`). **Nothing is parked** — no question, no action — and nothing waits for the person.
 *
 * Three answers, one state file, **never looser than before**: each is a deny or a note, never an
 * allow.
 *
 * - **PreToolUse on `AskUserQuestion` and `ExitPlanMode`**: denied, with the step that decides and
 *   records. Nothing is parked here either: the session records its own decision.
 * - **UserPromptSubmit**: one short note to Claude, said once per change — the state, the
 *   expected return or the number of items on the list — and again, in its own words, at the
 *   person's own prompt, which never switches the state back by itself (it may be one line from a
 *   phone). A session that heard "unavailable" is told once that the person is available again.
 * - **Stop**: a session that works on its own gets no prompt, so it would never hear the switch.
 *   Its stop is blocked once per away period, with the same note: heard at a prompt, the stop is
 *   silent; heard at the stop, the next prompt does not say it again. Available, a stop is never
 *   blocked (`stopAnswer`; the decision, which `notify` asks too, in `user-away-stop.ts`).
 *
 * **Claude Code's own permission prompt is not answered here.** A hook never approves for the
 * person, and it no longer denies or parks the call either: the prompt shows as Claude Code
 * shows it (`PermissionRequest` is not wired).
 *
 * **A state it cannot read changes nothing.** A broken state file is one line on stderr and the
 * answer the hook would have given without this feature: the question goes to the person as it
 * always did.
 *
 * What it cannot reach: a project's own copy of this hook (`ownHooks`) — but `ownHooks` cannot
 * switch it off (`alwaysOn`) — and the shim's `--missing=ask` (no bun at all), which cannot read
 * any state.
 */

import type { CliPaths } from "../cli/paths";
import { formatClock } from "../gateway/limit-state";
import {
  type AwayState,
  AwayStateError,
  forgetSaid,
  readAway,
  saidCovers,
  saidKey,
  sayOnce,
  stopSayOnce,
} from "../user-away/state";
import { type OwnerSources, ownedItems, waitingLines } from "../user-away/whose";
import { AVAILABLE_SKILL, DECISION_COMMAND, plural, UNAVAILABLE_SKILL } from "../user-away/words";
import { SHORT_GUARD_BUDGET_MS, startBudget } from "./budget";
import {
  addContext,
  type HookInput,
  type HookResult,
  SILENT,
  stringField,
  toolDecision,
} from "./io";
import { hasNotPersonWrapper } from "./prompt-source";
import type { Env } from "./run";
import { awayStopBlock, periodTag } from "./user-away-stop";

/** The two tools that put a question to the person: each waits for an answer nobody reads. */
export const AWAY_ASK_TOOLS = ["AskUserQuestion", "ExitPlanMode"] as const;

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

/** What a refused question tool reads: decide, record, go on. Nothing is parked. */
function decideStep(tool: string, when: string): string {
  const lead =
    tool === "ExitPlanMode"
      ? `the plan cannot be approved now. Take the recommended option yourself`
      : `do not wait for an answer. Take the recommended option yourself`;
  return `The person is unavailable${when}: ${lead}, keep working, and record the choice with \`${DECISION_COMMAND}\`. Never park a question or an action. The rules: ${UNAVAILABLE_SKILL}.`;
}

/** True when the prompt is the person's own words: a bare prompt, with no wrapper of Claude Code's. */
function isPersonsPrompt(input: HookInput): boolean {
  const prompt = stringField(input.prompt);
  return prompt !== null && !hasNotPersonWrapper(prompt);
}

function listText(count: number): string {
  if (count === 0) return "Nothing is recorded yet.";
  return `${plural(count, "item is", "items are")} on the list.`;
}

/** The standing note, at a prompt and at a stop: one home for its words. */
function unavailableNote(when: string, count: number): string {
  return `The person is unavailable${when}. Follow ${UNAVAILABLE_SKILL}: take the recommended option of every question, record each choice with \`${DECISION_COMMAND}\`, and keep working. ${listText(count)}`;
}

/**
 * Stop: a session that works on its own gets no prompt from the person, so it would never hear
 * the switch and could end its turn on a question in prose that nobody reads. So its stop is
 * blocked once per away period, with the note — decided by `awayStopBlock`
 * (`user-away-stop.ts`), which reads nothing written during a Stop, so `notify` can ask the same
 * question in either order. The reason ends with the period's tag: Claude Code writes it to the
 * transcript as the block's feedback, and that is what keeps the later stops silent; the stop the
 * block caused (`stop_hook_active`) is silent anyway, a belt against a loop. A count change alone is not
 * a block — a session's own park (the skill's `Summary:`) changes it, and that turn must be able
 * to end; the next prompt says it. The block is recorded in `stopSaid`, which the decision never
 * reads, so the next prompt does not say the note again, and "available again" still reaches the
 * session. A mark that cannot be written keeps the block, with one line why: the next prompt then
 * says the note once more.
 */
async function stopAnswer(
  input: HookInput,
  paths: CliPaths,
  nowMs: number,
  options: AwayOptions,
): Promise<HookResult> {
  const block = awayStopBlock(input, paths.stateDir);
  if (block === null) return SILENT;
  const { session, state } = block;
  const reason = `${unavailableNote(whenText(state, nowMs, options), state.items.length)} Do not end the turn on a question for them: take the recommended option, record it, and go on. If nothing is left to do, end the turn. ${periodTag(state)}`;
  const answer = { stdout: JSON.stringify({ decision: "block", reason }) };
  try {
    await stopSayOnce(paths.stateDir, session, saidKey(state));
    return answer;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return {
      ...answer,
      stderr: `cc-smart-dev-kit user-away: could not record the stop note: ${why}`,
    };
  }
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
  const key = saidKey(state);
  // Heard at its turn end (the Stop block) and not at a prompt since: the note is not said again,
  // and `said` now covers the period, so the stops after it are decided without reading the
  // transcript. Once `said` covers the period, `stopSaid` is stale: a count that comes back to the
  // block's count is a change the prompt says.
  const heardAtStop = state.stopSaid[session] === key && !saidCovers(state, session);
  const first = (await sayOnce(paths.stateDir, session, key)) && !heardAtStop;
  if (isPersonsPrompt(input)) {
    const waiting =
      count === 0
        ? "Nothing is recorded yet."
        : `${plural(count, "item waits", "items wait")} for ${AVAILABLE_SKILL}.`;
    return addContext(
      "UserPromptSubmit",
      `The person wrote, and is still marked unavailable${when}: a message does not switch it back (it may come from a phone). Do what it asks, and keep following ${UNAVAILABLE_SKILL}. ${waiting}`,
    );
  }
  if (!first) return SILENT;
  return addContext("UserPromptSubmit", unavailableNote(when, count));
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
      if (tool === null || !inAwayDomain(input)) return SILENT;
      const state = readAway(paths.stateDir);
      if (!state.unavailable) return SILENT;
      return toolDecision("deny", decideStep(tool, whenText(state, nowMs, options)));
    }
    if (event === "UserPromptSubmit") return await noteAnswer(input, env, paths, nowMs, options);
    if (event === "Stop") return await stopAnswer(input, paths, nowMs, options);
    return SILENT;
  } catch (error) {
    if (error instanceof AwayStateError) return { stderr: stateLine(error) };
    throw error;
  }
}
