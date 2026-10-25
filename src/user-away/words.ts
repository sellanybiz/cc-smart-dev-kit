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

/** The longest words and command a park keeps: a question, not a transcript. */
export const TEXT_MAX = 4_000;
export const COMMAND_MAX = 16_000;

/** `cc-smart-dev-kit user --help`, and what `user` with no command prints. */
export const USER_USAGE = `Usage: ${COMMAND} user <command>

The person's availability. While they cannot answer, a session parks what needs them instead
of asking, and the hooks hold the line (${UNAVAILABLE_SKILL}).

Commands:
  unavailable [--until <time>]
                 The person cannot answer now. --until says when they are expected back
                 (8h, 90m, 07:30 or an ISO time): a note only, it never switches back.
  available      They can answer again. What was parked stays on the list for them.
  status [--json]
                 Whether they can answer, and how many items wait.
  park --kind <question|action|decision> "<text>" [--command "<command>"]
       [--option "<option>"]... [--recommend <n>] [--crew <name>]
                 Put one item on the list. An action names its exact command, a question its
                 options and the recommended one (counted from 1). --crew names the crew
                 session the item is for, when a lead parks its crew session's question.
  list [--json]  The items, each with its exact command.
  clear <n>... | --all
                 Take answered items off the list.

Use ${AVAILABLE_SKILL} when the person is back: it goes through the list with them.`;
