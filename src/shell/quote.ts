/**
 * Writing a value as one word of a POSIX shell line: the one home of both forms, beside the
 * reader of such lines (`command.ts`). The launcher, the job queue's rewrite and the commands
 * that print a fix line all quote through here.
 */

/** Quotes a value for sh: single quotes, with each ' written as '\''. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * A value as one word for sh: as it is when it holds only letters, digits and `_ . / -`, else
 * `shellQuote`d. The bare set is narrow on purpose: every other character may mean something to
 * a shell (`=` after a name, `@`, `%`, `:` and `,` in some expansions), and quoting is always safe.
 */
export function shellWord(value: string): string {
  return /^[\w./-]+$/.test(value) ? value : shellQuote(value);
}
