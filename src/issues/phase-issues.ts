/**
 * The issues a crew phase fixes (decision D67): the numbers its report names, and the issue
 * `crew start --issue <n>` stored on its record. One home, read by the report (which writes the
 * list) and by the watch (which marks them at the merge).
 */

/**
 * The issue number a crew record carries from `crew start --issue`, read by shape: a record that
 * has no such field (an older one) has no issue. The number is whatever whole number above 0 the
 * record holds, and nothing else.
 */
export function recordIssueNumbers(record: object): number[] {
  const issue = "issue" in record ? record.issue : undefined;
  if (typeof issue !== "object" || issue === null || !("number" in issue)) return [];
  const { number } = issue;
  return typeof number === "number" && Number.isInteger(number) && number > 0 ? [number] : [];
}

/** The issues of a phase, each once, ascending: the report's list joined with the record's. */
export function phaseIssues(
  record: object,
  report: { issues?: readonly number[] | undefined } | null,
): number[] {
  return [...new Set([...(report?.issues ?? []), ...recordIssueNumbers(record)])].sort(
    (a, b) => a - b,
  );
}
