/**
 * Where a prompt came from: the one signal a `UserPromptSubmit` hook has. Its input names no
 * source, so the first characters of the prompt are all there is. Two hooks read it
 * (`crew-role`: the person's own prompt to a crew session; `user-away`: the person's own prompt
 * while they are marked unavailable), and neither may carry the other's code, so it lives here.
 */

/**
 * The wrappers and labels Claude Code puts around a turn that is not the person's own words.
 * Proved live on 2.1.309 (`docs/claude-code-contract.md`): the hook input carries no field that
 * says where a prompt came from, so these first characters are the one signal there is.
 *
 * - `<cross-session-message from=… from-name=… from-mode=…>`: another session's message, sent
 *   with `SendMessage` — a lead's note, `crew answer` to a running crew session, a peer's
 *   `crew tell`.
 * - `<task-notification>`: a monitor's line (the `crew-self` monitor), and any background task's
 *   event.
 * - `<agent-message from=…>`: a subagent's hand-back the crew session itself launched (its
 *   reviewer, a builder), delivered as a turn of its own (seen live on 2.1.309).
 * - `Stop hook feedback:`: a Stop hook's block continued the turn with its reason (the kit's own
 *   is `reportStep()`), and the same check catches the bare reason, should a transport drop the
 *   label.
 */
export const NOT_PERSON_PREFIXES = [
  "<cross-session-message",
  "<task-notification",
  "<agent-message",
  "Stop hook feedback:",
] as const;

/** True when `prompt` starts with one of the wrappers: a turn that is not the person's words. */
export function hasNotPersonWrapper(prompt: string): boolean {
  return NOT_PERSON_PREFIXES.some((prefix) => prompt.startsWith(prefix));
}
