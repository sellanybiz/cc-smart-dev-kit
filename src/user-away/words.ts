/**
 * The few words and limits the command (`command.ts`), the help (`src/cli/help.ts`) and the
 * hooks (`src/hooks/user-away.ts`) all say. One home, and it imports neither the command's output
 * code nor the help: a hook bundle must never reach `src/cli/ui/`
 * (`.claude/rules/command-output.md`), and the help imports this file, so it may not import the
 * help back.
 */

import { COMMAND, PLUGIN } from "../build-info/names";

/** The skill a session reads while the person cannot answer, and the one that goes through the list. */
export const UNAVAILABLE_SKILL = `/${PLUGIN}:user-unavailable`;
export const AVAILABLE_SKILL = `/${PLUGIN}:user-available`;

/** What a session runs to record a choice it made while the person is away: the one command it writes. */
export const DECISION_COMMAND = `${COMMAND} user park --kind decision "Summary: <what you chose, why, how to undo>"`;

/**
 * `1 item`, `2 items`. The command's output module has its own, which a hook bundle may not reach
 * (above), so the command, the hook and `whose.ts` share this one.
 */
export function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** The longest words and command a park keeps: a question, not a transcript. */
export const TEXT_MAX = 4_000;
export const COMMAND_MAX = 16_000;

/** `cc-smart-dev-kit user --help`, and what `user` with no command prints. */
export const USER_USAGE = `Usage: ${COMMAND} user <command>

The person's availability. While they cannot answer, a session takes the recommended option
instead of asking and records each choice as a decision (${UNAVAILABLE_SKILL}).

Commands:
  unavailable [--until <time>]
                 The person cannot answer now. --until says when they are expected back
                 (8h, 90m, 07:30 or an ISO time): a note only, it never switches back.
  available      They can answer again. What was parked stays on the list for them.
  status [--json]
                 Whether they can answer, and how many items wait.
  park --kind <question|action|decision> "<text>" [--command "<command>"]
       [--option "<option>"]... [--recommend <n>]
                 Put one item on the list. A session records a decision ("Summary: ..."). A
                 question names its options and the recommended one (counted from 1), an
                 action its exact command: both are for the person's own use and old items.
  list [--json]  The items, each with who answers it and its exact command. Judged for the
                 session that runs it: this session's, another session's, or no session's.
  clear <n>... | --all
                 Take answered items off the list.

Use ${AVAILABLE_SKILL} when the person is back: it goes through the list with them.`;
