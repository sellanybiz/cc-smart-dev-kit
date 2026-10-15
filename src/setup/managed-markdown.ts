import { existsSync, readFileSync } from "node:fs";
import { realTarget, retryOnConcurrentChange, type WriteResult, writeManagedFile } from "./write";

export const BLOCK_BEGIN = "<!-- cc-agentic:begin -->";
export const BLOCK_END = "<!-- cc-agentic:end -->";

export interface ManagedMarkdownOptions {
  file: string;
  stateDir: string;
  /** The text between the markers. */
  body: string;
  dryRun?: boolean;
  /** Tests only: runs after the read and before the write, to play another program's write. */
  onBeforeWrite?: () => void;
}

function countOf(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

/** Where the one block is: null when there is none; throws when the markers are broken. */
function findBlock(current: string, file: string): { start: number; end: number } | null {
  const begins = countOf(current, BLOCK_BEGIN);
  const ends = countOf(current, BLOCK_END);
  if (begins === 0 && ends === 0) return null;
  const start = current.indexOf(BLOCK_BEGIN);
  const end = current.indexOf(BLOCK_END);
  if (begins !== 1 || ends !== 1 || end < start) {
    throw new Error(
      `${file} has a broken cc-agentic block (${begins} begin and ${ends} end markers). ` +
        "Fix it by hand: keep one begin marker and one end marker after it.",
    );
  }
  return { start, end: end + BLOCK_END.length };
}

/** The whole file with the block in it: replaced in place when present, appended when not. */
export function renderManagedMarkdown(current: string, body: string, file = "the file"): string {
  const block = `${BLOCK_BEGIN}\n${body.replace(/\n+$/, "")}\n${BLOCK_END}`;
  const found = findBlock(current, file);
  if (found === null) {
    if (current === "") return `${block}\n`;
    const separator = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
    return `${current}${separator}${block}\n`;
  }
  return `${current.slice(0, found.start)}${block}${current.slice(found.end)}`;
}

/**
 * The file without the block. It also takes out the line break after the block and the
 * blank line that separated it, so an appended block leaves the text as it was.
 */
export function renderWithoutBlock(current: string, file = "the file"): string {
  const found = findBlock(current, file);
  if (found === null) return current;
  let before = current.slice(0, found.start);
  let after = current.slice(found.end);
  if (after.startsWith("\n")) after = after.slice(1);
  if (before === "" && after.startsWith("\n")) after = after.slice(1);
  if (before.endsWith("\n\n") && (after === "" || after.startsWith("\n"))) {
    before = before.slice(0, -1);
  }
  return `${before}${after}`;
}

function writeMarkdown(
  options: { file: string; stateDir: string; dryRun?: boolean; onBeforeWrite?: () => void },
  render: (current: string, file: string) => string,
): WriteResult {
  const file = realTarget(options.file);
  return retryOnConcurrentChange(file, () => {
    const text = existsSync(file) ? readFileSync(file, "utf8") : null;
    const next = render(text ?? "", file);
    if (text === null && next === "") return { outcome: "unchanged", backup: null };
    options.onBeforeWrite?.();
    return writeManagedFile(file, next, {
      stateDir: options.stateDir,
      kind: "markdown-block",
      newFileMode: 0o644,
      expectedContent: text,
      ...(options.dryRun !== undefined && { dryRun: options.dryRun }),
    });
  });
}

/** Puts one cc-agentic block into a Markdown file; the text around it is kept as it is. */
export function applyManagedMarkdown(options: ManagedMarkdownOptions): WriteResult {
  return writeMarkdown(options, (current, file) =>
    renderManagedMarkdown(current, options.body, file),
  );
}

/** Takes the cc-agentic block out of a Markdown file; the text around it is kept. */
export function removeManagedMarkdown(options: {
  file: string;
  stateDir: string;
  dryRun?: boolean;
}): WriteResult {
  return writeMarkdown(options, renderWithoutBlock);
}
