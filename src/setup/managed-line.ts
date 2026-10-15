/**
 * One managed line in a text file: setup adds an exact line at the end, and restore takes
 * out exactly the lines anymodel added (recorded in `changed.json`), keeping everything
 * else — the person's own lines, their order, and any line they edited since. The other
 * managed kinds: `managed-json.ts`, `managed-entries.ts`, `managed-markdown.ts`.
 *
 * Used for tmux's config (`src/setup/tmux.ts`): the line that lets an alert from a pane
 * reach the terminal the person is looking at.
 */
import { existsSync, readFileSync } from "node:fs";
import { realTarget, retryOnConcurrentChange, type WriteOutcome, writeManagedFile } from "./write";

export interface ManagedLineOptions {
  file: string;
  /** The exact line anymodel adds (compared as the whole line, without trimming). */
  line: string;
  stateDir: string;
  dryRun?: boolean;
}

/** The file's text with the line at its end: one line per line, the file ending in one newline. */
export function renderWithLine(current: string, line: string): string {
  const text = current === "" || current.endsWith("\n") ? current : `${current}\n`;
  return `${text}${line}\n`;
}

/** The file's text without every line equal to one of `lines`. */
export function renderWithoutLines(current: string, lines: readonly string[]): string {
  const unwanted = new Set(lines);
  return current
    .split("\n")
    .filter((one) => !unwanted.has(one))
    .join("\n");
}

export interface ManagedLineResult {
  /** The backup of the file's state just before this change. */
  backup: null | string;
  /** The lines this call took out (empty for an add, or when none were there). */
  removed: string[];
  outcome: WriteOutcome;
}

/**
 * Reads the file, renders the change, and writes it under the managed rule — or reports
 * it in a dry run. The read, the render and the write happen inside one retry, so a change
 * another program makes in between is never lost.
 */
function writeRendered(
  file: string,
  stateDir: string,
  render: (current: string) => { removed?: string[]; text: string },
  options: { dryRun?: boolean | undefined; lines?: string[] | undefined },
): ManagedLineResult {
  const target = realTarget(file);
  return retryOnConcurrentChange(target, () => {
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    const { removed, text } = render(current ?? "");
    if (current === null && text === "") {
      return { backup: null, outcome: "unchanged", removed: removed ?? [] };
    }
    const result = writeManagedFile(target, text, {
      stateDir,
      kind: "file-line",
      ...(options.lines !== undefined && { lines: options.lines }),
      newFileMode: 0o644,
      expectedContent: current,
      ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
    });
    return { backup: result.backup, outcome: result.outcome, removed: removed ?? [] };
  });
}

/**
 * Puts the line at the end of the file, when it is not there already. A file that already
 * has the exact line (the person's own, or an earlier setup) is left alone and nothing is
 * claimed: restore never takes out a line anymodel did not add.
 */
export function applyManagedLine(options: ManagedLineOptions): ManagedLineResult {
  return writeRendered(
    options.file,
    options.stateDir,
    (current) =>
      current.split("\n").includes(options.line)
        ? { text: current }
        : { text: renderWithLine(current, options.line) },
    { dryRun: options.dryRun, lines: [options.line] },
  );
}

/**
 * Takes the lines anymodel added out again, keeping every other line. A line the person
 * changed or removed since is not there to remove: nothing happens for it.
 */
export function removeManagedLines(options: {
  file: string;
  lines: readonly string[];
  stateDir: string;
  dryRun?: boolean;
}): ManagedLineResult {
  return writeRendered(
    options.file,
    options.stateDir,
    (current) => ({
      removed: current.split("\n").filter((one) => options.lines.includes(one)),
      text: renderWithoutLines(current, options.lines),
    }),
    { dryRun: options.dryRun },
  );
}
