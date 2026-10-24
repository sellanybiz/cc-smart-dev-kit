/**
 * The action runs this tab has going. The live stream names an action's progress line by the
 * action alone, never by the control that started it, so two controls running the same action at
 * once (two slots of a profile saved together) cannot tell whose line it is. A control shows a
 * line only when it is the action's only run here; otherwise it keeps "Working…".
 */

const running = new Map<string, Set<symbol>>();

/** Starts a run of `action`; the returned function ends it, and ending twice counts once. */
export function beginRun(action: string): () => void {
  const token = Symbol(action);
  const tokens = running.get(action) ?? new Set<symbol>();
  tokens.add(token);
  running.set(action, tokens);
  return () => {
    const held = running.get(action);
    if (held === undefined) return;
    held.delete(token);
    if (held.size === 0) running.delete(action);
  };
}

/** True when a progress line of `action` can only belong to the run a control has going. */
export function ownsProgress(action: string): boolean {
  return (running.get(action)?.size ?? 0) <= 1;
}
