/**
 * The `user-away` Stop decision, one home: does this stop get the one block that tells a session
 * the person is away? `stopAnswer` in `user-away.ts` answers with it, and `notify` asks it, read
 * only, so its "finished" alert waits for the stop that really ends the turn.
 *
 * **It reads nothing that is written during a Stop.** Claude Code runs an event's hooks in
 * parallel, so `notify` may read before or after `user-away` answers; both must see the same
 * inputs. The decision reads three things, and none of them changes while the Stop hooks run:
 *
 * 1. the state is unavailable (`state.json`, switched only by the `user` command);
 * 2. this session's `said` mark does not cover this away period (`since|until`): only the prompt
 *    note and `user unavailable` write `said`, and neither runs during a Stop;
 * 3. the session's transcript holds no `user-away` Stop feedback for this period: Claude Code
 *    writes a block's feedback only after every Stop hook has answered. The block's reason
 *    carries the period's tag (`periodTag`), and the feedback is found the way `keep-going` finds
 *    its own (`stopFeedbackGiven`), in the transcript's tail.
 *
 * The Stop answer's own mark (`stopSaid`) is written during the Stop, so the decision never reads
 * it: only the prompt note does, so a prompt after the block does not say the note again.
 *
 * No transcript, or one that cannot be read: no block. The hook could not see its own earlier
 * block, and a block that cannot be seen would come back at every stop: a note never traps a turn.
 */

import { accessSync, constants } from "node:fs";
import type { CliPaths } from "../cli/paths";
import { type AwayState, AwayStateError, readAway } from "../user-away/state";
import { type HookInput, stringField } from "./io";
import { stopFeedbackGiven } from "./transcript";

/** The away period a note names: a new `user unavailable` (or a new `--until`) is a new one. */
export function periodKey(state: AwayState): string {
  return `${state.since}|${state.until}`;
}

/**
 * What a session heard last (`said`, `stopSaid`): the period and the count, so a change is said
 * again at the prompt. The `user unavailable` command writes it too, for the session that switches
 * the state.
 */
export function saidKey(state: AwayState): string {
  return `${periodKey(state)}|${String(state.items.length)}`;
}

/** The tag a Stop block's reason ends with, so its feedback in the transcript names its period. */
export function periodTag(state: AwayState): string {
  return `[away period ${periodKey(state)}]`;
}

/** True when the file can be opened for reading. */
function readable(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The session and the state when this stop gets the block; null when it does not. Reads, never
 * writes. Throws `AwayStateError` when the state file cannot be read.
 */
export function awayStopBlock(
  input: HookInput,
  stateDir: string,
): { session: string; state: AwayState } | null {
  const session = stringField(input.session_id);
  if (session === null) return null;
  const state = readAway(stateDir);
  if (!state.unavailable) return null;
  if (state.said[session]?.startsWith(`${periodKey(state)}|`) === true) return null;
  const transcript = stringField(input.transcript_path);
  if (transcript === null || !readable(transcript)) return null;
  if (stopFeedbackGiven(transcript, periodTag(state), [])) return null;
  return { session, state };
}

/**
 * `awayStopBlock` for a sibling hook (`notify`): true when `user-away` blocks this stop. A state
 * file it cannot read is false, as `user-away` then blocks nothing either.
 */
export function awayStopWouldBlock(input: HookInput, paths: CliPaths): boolean {
  try {
    return awayStopBlock(input, paths.stateDir) !== null;
  } catch (error) {
    if (error instanceof AwayStateError) return false;
    throw error;
  }
}
