/**
 * The `user-away` Stop decision, one home: does this stop get the one block that tells a session
 * the person is away? `stopAnswer` in `user-away.ts` answers with it, and `notify` asks it, read
 * only, so its "finished" alert waits for the stop that really ends the turn.
 *
 * **It reads nothing that is written during a Stop.** Claude Code runs an event's hooks in
 * parallel, so `notify` may read before or after `user-away` answers; both must see the same
 * inputs. The decision reads the stop's own input (no block when `stop_hook_active`: a Stop hook
 * continued this turn) and three things more, none of which changes while the Stop hooks run:
 *
 * 1. the state is unavailable (`state.json`, switched only by the `user` command);
 * 2. this session's `said` mark does not cover this away period (`since|until`): only the prompt
 *    note and `user unavailable` write `said`, and neither runs during a Stop;
 * 3. the session's transcript holds no `user-away` Stop feedback for this period: Claude Code
 *    writes a block's feedback only after every Stop hook has answered. The block's reason
 *    carries the period's tag (`periodTag`), and the feedback is found the way `keep-going` finds
 *    its own (`stopFeedbackIn`, on one read of the transcript's tail).
 *
 * The Stop answer's own mark (`stopSaid`) is written during the Stop, so the decision never reads
 * it: only the prompt note does, so a prompt after the block does not say the note again.
 *
 * No transcript, or one that cannot be read: no block. The hook could not see its own earlier
 * block, and a block that cannot be seen would come back at every stop: a note never traps a turn.
 */

import type { CliPaths } from "../cli/paths";
import {
  type AwayState,
  AwayStateError,
  periodKey,
  readAway,
  saidCovers,
} from "../user-away/state";
import { type HookInput, stringField } from "./io";
import { stopFeedbackIn, tailLines } from "./transcript";

/** The tag a Stop block's reason ends with, so its feedback in the transcript names its period. */
export function periodTag(state: AwayState): string {
  return `[away period ${periodKey(state)}]`;
}

/**
 * The session and the state when this stop gets the block; null when it does not. Reads, never
 * writes. Throws `AwayStateError` when the state file cannot be read.
 *
 * **Never on a stop a Stop hook continued** (`stop_hook_active`, an input field, the same for
 * every hook of the event): a belt against a loop. If Claude Code ever stored the feedback in a
 * shape `stopFeedbackIn` does not find, the session is still blocked at most once per chain of
 * continued stops, never up to Claude Code's cap. The cost: a stop another hook continued does
 * not carry the note; the next stop that no hook continued does.
 */
export function awayStopBlock(
  input: HookInput,
  stateDir: string,
): { session: string; state: AwayState } | null {
  if (input.stop_hook_active === true) return null;
  const session = stringField(input.session_id);
  if (session === null) return null;
  const state = readAway(stateDir);
  if (!state.unavailable) return null;
  if (saidCovers(state, session)) return null;
  const transcript = stringField(input.transcript_path);
  const lines = transcript === null ? null : tailLines(transcript);
  if (lines === null) return null;
  if (stopFeedbackIn(lines, periodTag(state), [])) return null;
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
