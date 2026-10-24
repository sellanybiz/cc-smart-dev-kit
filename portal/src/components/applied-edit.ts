/**
 * A form that is edited, applied, and then waits for the page's answer to be read again.
 * Dropping the edit at the result would snap the form back to the old answer (and its "this is
 * the state now" words) until the debounced read lands. So an applied edit stays on show while
 * the answer is still the one it was made against, and the new answer takes over when it comes.
 */

/** An edit: the form's draft, and once Apply succeeded, the answer it was applied against. */
export type Edit<D, A> = { applied: false; draft: D } | { answer: A; applied: true; draft: D };

/** The edit after a successful Apply, remembering the answer on show then. */
export function appliedEdit<D, A>(edit: Edit<D, A> | null, answer: A): Edit<D, A> | null {
  return edit === null ? null : { answer, applied: true, draft: edit.draft };
}

/**
 * The edit while it counts: one being typed, or an applied one on the answer it was made
 * against. An applied edit that a new answer replaced is no edit — nothing is left to discard.
 */
export function liveEdit<D, A>(edit: Edit<D, A> | null, answer: A): Edit<D, A> | null {
  return edit?.applied && edit.answer !== answer ? null : edit;
}

/** What the form shows: the live edit, else the answer's own draft. */
export function shownDraft<D, A>(
  edit: Edit<D, A> | null,
  answer: A,
  fromAnswer: (answer: A) => D,
): D {
  return liveEdit(edit, answer)?.draft ?? fromAnswer(answer);
}
