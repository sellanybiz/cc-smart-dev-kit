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

/** What the form shows: the edit, until a new answer replaces the one an applied edit was made on. */
export function shownDraft<D, A>(
  edit: Edit<D, A> | null,
  answer: A,
  fromAnswer: (answer: A) => D,
): D {
  if (edit === null) return fromAnswer(answer);
  return edit.applied && edit.answer !== answer ? fromAnswer(answer) : edit.draft;
}
