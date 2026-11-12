/**
 * Where a prompt came from: the one signal a `UserPromptSubmit` hook has. Its input names no
 * source, so the first characters of the prompt are all there is. `user-away` reads it (the
 * person's own prompt while they are marked unavailable); it lives in its own module so a
 * second reader imports it, never a copy.
 */

import { REPORT_TAG } from "../herdr/labels";
import { STOP_FEEDBACK } from "./transcript";

/**
 * The wrappers and labels Claude Code puts around a turn that is not the person's own words.
 * Proved live on 2.1.309 (`docs/claude-code-contract.md`): the hook input carries no field that
 * says where a prompt came from, so these first characters are the one signal there is.
 *
 * - `<cross-session-message from=… from-name=… from-mode=…>`: another session's message, sent
 *   with `SendMessage`.
 * - `<task-notification>`: a background task's event (a background command or agent that
 *   ended, a monitor's line).
 * - `<agent-message from=…>`: a subagent's hand-back that the session itself launched (its
 *   reviewer, a builder), delivered as a turn of its own (seen live on 2.1.309).
 * - `Stop hook feedback:`: a Stop hook's block continued the turn with its reason (the kit's own
 *   `verify-gate` and `keep-going` block this way), and the same check catches the bare reason,
 *   should a transport drop the label.
 */
export const NOT_PERSON_PREFIXES = [
  "<cross-session-message",
  "<task-notification",
  "<agent-message",
  "<hc ",
  `<${REPORT_TAG}`,
  STOP_FEEDBACK,
] as const;

/** True when `prompt` starts with one of the wrappers: a turn that is not the person's words. */
export function hasNotPersonWrapper(prompt: string): boolean {
  const text = prompt.trimStart();
  return NOT_PERSON_PREFIXES.some((prefix) => text.startsWith(prefix));
}
