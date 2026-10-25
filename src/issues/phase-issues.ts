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

/**
 * The most issues one phase may fix. Each one is a mark at the merge (a comment and a label, a few
 * `gh` calls); the watch settles a few per pass, and a report that named hundreds would hold the
 * queue for hours. A phase that fixes more is split.
 */
export const MAX_PHASE_ISSUES = 10;

/**
 * The heading of the block a continuation's brief adds for what the old crew session left behind
 * (`reportBlock` in `start.ts`): its own words, not the lead's.
 */
const LEFT_BEHIND_HEADING = /^## What .+ left behind[ \t]*$/m;

/**
 * The issue numbers the lead's own brief names, written `#12`. What is not the lead's is left out:
 * the lines behind `> ` (an issue's quoted text, `issueBlock` in `brief.ts`) and everything from
 * the block a continuation adds with the old crew session's report (`LEFT_BEHIND_HEADING`), whose
 * words the crew session wrote. A number in either names nothing the lead chose. Only `#12` counts,
 * not an address: an address may be another repository's. A number the lead writes for a pull
 * request or a step counts too (it still has to be in the report to be marked at all).
 */
export function briefIssueNumbers(text: string): number[] {
  const cut = LEFT_BEHIND_HEADING.exec(text);
  const lead = cut === null ? text : text.slice(0, cut.index);
  const own = lead
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
  const numbers = [...own.matchAll(/#([1-9][0-9]{0,8})\b/g)].map((one) => Number(one[1]));
  return [...new Set(numbers)].sort((a, b) => a - b);
}

/** A phase's issues, split by whether anything the lead wrote names them. */
export interface CheckedIssues {
  /** The ones that are marked: the record's own issue, and every number the brief names too. */
  marks: number[];
  /** Named by the report only: not marked. */
  unnamed: number[];
}

/**
 * Which of a phase's issues the watch may mark. A crew report is the crew session's own word: a
 * number it names counts only when the record's issue (`crew start --issue`) or the lead's brief
 * names it too. `brief` is the brief's text, or null when it could not be read (then the
 * record's issue alone counts).
 */
export function checkPhaseIssues(
  record: object,
  report: { issues?: readonly number[] | undefined } | null,
  brief: null | string,
): CheckedIssues {
  const known = new Set([
    ...recordIssueNumbers(record),
    ...(brief === null ? [] : briefIssueNumbers(brief)),
  ]);
  const all = phaseIssues(record, report);
  return {
    marks: all.filter((one) => known.has(one)),
    unnamed: all.filter((one) => !known.has(one)),
  };
}

/**
 * The line the lead hears for an issue a report names that nothing the lead wrote does. It says
 * what the lead does if it agrees after reading the diff: GitHub closes an issue a release's pull
 * request names with `Fixes #<n>`, and no command of the kit marks one by hand (a session could
 * run it too, which is what the check stops).
 */
export function unnamedIssueLine(name: string, issue: number, briefRead: boolean): string {
  const where = briefRead
    ? "the brief or the record's issue"
    : "the record's issue (its brief could not be read)";
  return `issues: #${issue} is named by the report of ${name} but not by ${where}: not marked. If the phase did fix it, put "Fixes #${issue}" in the release pull request's body`;
}
