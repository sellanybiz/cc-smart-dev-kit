/** The most items an informational hook puts in one list. */
export const HOOK_LIST_LIMIT = 8;

/** Bounded hook context: show the first items, then tell the reader how to find the rest. */
export function cappedHookList<T>(
  items: readonly T[],
  render: (item: T) => string,
  command: string,
  separator = ", ",
): string {
  const shown = items.slice(0, HOOK_LIST_LIMIT).map(render);
  if (items.length > HOOK_LIST_LIMIT)
    shown.push(`+${items.length - HOOK_LIST_LIMIT} more: ${command}`);
  return shown.join(separator);
}
