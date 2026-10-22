/**
 * The one way a command prints to a person: headings, groups, marked lines with their `Fix:`,
 * a verdict, progress while a slow step runs, and JSON. In-house on purpose: the CLI has one
 * runtime dependency (zod), and this needs no colour or spinner library.
 *
 * **Rich on a terminal, plain otherwise, and the same words in both** (`terminal.ts`): rich adds
 * colour on the marks and the verdict, a progress line, and wrapping to the width — never a word.
 * So a test of the plain text is a test of what a person reads.
 *
 * **Every mark comes with words.** ✓ ✗ · ! never carry the meaning alone: a verdict and a group
 * line say it in words too ("2 to fix"), so colour-blind readers, `NO_COLOR` and a screen reader
 * lose nothing.
 *
 * **Never in the router bundle, a hook's stdout or `browser mcp`'s stdout**: each of those
 * streams is read by a program (Claude Code, the MCP client), not a person. A test walks their
 * imports (`out.test.ts` › "who never imports it").
 */
import { FIX_LABEL } from "../check";
import type { Terminal } from "./terminal";

/** A line's mark: a check's status, or a change setup made. */
export type Mark = "changed" | "created" | "fail" | "info" | "ok" | "removed" | "warn";

const UNICODE_MARKS: Readonly<Record<Mark, string>> = {
  changed: "~",
  created: "+",
  fail: "✗",
  info: "·",
  ok: "✓",
  removed: "-",
  warn: "!",
};

/** The marks on an old Windows console: the ones the Windows installer prints too. */
const ASCII_MARKS: Readonly<Record<Mark, string>> = {
  changed: "~",
  created: "+",
  fail: "[x]",
  info: "[i]",
  ok: "[ok]",
  removed: "-",
  warn: "[!]",
};

export { FIX_LABEL };

const COLOURS: Readonly<Record<Mark, number>> = {
  changed: 33,
  created: 32,
  fail: 31,
  info: 2,
  ok: 32,
  removed: 31,
  warn: 33,
};

/**
 * The characters the CLI's words use that an old console cannot show, and what it shows
 * instead. A character not listed stays as it is: a path or a name is the person's own.
 */
const ASCII_TEXT: ReadonlyArray<readonly [string, string]> = [
  ["—", "-"],
  ["–", "-"],
  ["→", "->"],
  ["←", "<-"],
  ["…", "..."],
  ["≥", ">="],
  ["≤", "<="],
  ["·", "-"],
  ["•", "*"],
  ["✓", "[ok]"],
  ["✗", "[x]"],
  ["‘", "'"],
  ["’", "'"],
  ["“", '"'],
  ["”", '"'],
];

/** The text an old console can show (`terminal.ts` › unicode). */
export function asciiText(text: string): string {
  let out = text;
  for (const [from, to] of ASCII_TEXT) out = out.replaceAll(from, to);
  return out;
}

/** A mark as this terminal shows it, without colour. */
export function markText(term: Terminal, mark: Mark): string {
  return (term.unicode ? UNICODE_MARKS : ASCII_MARKS)[mark];
}

function paint(term: Terminal, code: number, text: string): string {
  return term.color ? `\x1b[${code}m${text}\x1b[0m` : text;
}

function words(term: Terminal, text: string): string {
  return term.unicode ? text : asciiText(text);
}

/**
 * Words onto lines: the first at most `firstWidth` columns, the rest at most `restWidth`.
 * A word longer than its line (a long path) stands alone on its line, never cut. A newline in
 * the text starts a new line. Columns are counted as the terminal draws them
 * (`Bun.stringWidth`).
 */
export function wrapWords(text: string, firstWidth: number, restWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const width = lines.length === 0 ? firstWidth : restWidth;
      const candidate = line === "" ? word : `${line} ${word}`;
      if (line !== "" && Bun.stringWidth(candidate) > width) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** One marked line, and its `Fix:` under it: what `line` prints. */
export interface LineOptions {
  /** What fixes it. Printed on its own line, under the text: `Fix: <fix>`. */
  fix?: string | undefined;
  /** Spaces before the mark. */
  indent?: number;
}

/** The lines `line` prints, with no newline at their end. Pure, so a test reads exact text. */
export function renderLine(
  term: Terminal,
  mark: Mark,
  text: string,
  options: LineOptions = {},
): string[] {
  const indent = " ".repeat(options.indent ?? 0);
  const shown = markText(term, mark);
  const hang = " ".repeat(indent.length + Bun.stringWidth(shown) + 1);
  const room = term.width - hang.length;
  const body = wrapWords(words(term, text), room, room);
  const lines = body.map((part, index) =>
    index === 0 ? `${indent}${paint(term, COLOURS[mark], shown)} ${part}` : `${hang}${part}`,
  );
  if (options.fix !== undefined) {
    const fixHang = `${hang}${" ".repeat(FIX_LABEL.length + 1)}`;
    const fixRoom = room - FIX_LABEL.length - 1;
    const fix = wrapWords(words(term, options.fix), fixRoom, fixRoom);
    lines.push(
      ...fix.map((part, index) =>
        index === 0 ? `${hang}${FIX_LABEL} ${part}` : `${fixHang}${part}`,
      ),
    );
  }
  return lines;
}

/** A group's own line: its mark, its title padded to `titleWidth`, and what it holds in words. */
export interface GroupHeader {
  mark: Mark;
  title: string;
  /** "8 passed", "1 to fix, 4 passed". */
  summary: string;
  /** The longest title of the report, so every summary starts in one column. */
  titleWidth: number;
}

/** A line inside a group. */
export interface GroupLine {
  mark: Mark;
  text: string;
  fix?: string | undefined;
}

/** A group: its line, then its lines indented under it. Pure. */
export function renderGroup(term: Terminal, header: GroupHeader, lines: GroupLine[]): string[] {
  const title = `${words(term, header.title).padEnd(header.titleWidth)}  ${header.summary}`;
  return [
    ...renderLine(term, header.mark, title),
    ...lines.flatMap((line) =>
      renderLine(term, line.mark, line.text, { fix: line.fix, indent: 2 }),
    ),
  ];
}

/** The verdict: one line, the whole of it in its mark's colour. Pure. */
export function renderVerdict(term: Terminal, mark: Mark, text: string): string[] {
  const room = term.width - Bun.stringWidth(markText(term, mark)) - 1;
  const hang = " ".repeat(Bun.stringWidth(markText(term, mark)) + 1);
  return wrapWords(words(term, text), room, room).map((part, index) =>
    paint(term, COLOURS[mark], index === 0 ? `${markText(term, mark)} ${part}` : `${hang}${part}`),
  );
}

/**
 * The last line of a `--dry-run`, in one form for every command (UX-16): what the run did not
 * do, `["written", "run"]` → "Dry run: nothing was written or run."
 */
export function dryRunEnding(notDone: readonly string[]): string {
  const last = notDone.at(-1) ?? "changed";
  const list = notDone.length <= 1 ? last : `${notDone.slice(0, -1).join(", ")} or ${last}`;
  return `Dry run: nothing was ${list}.`;
}

/** The marks a line of text may start with, as `setup` and `restore` have always written them. */
const LEADING_MARKS: ReadonlyArray<readonly [string, Mark]> = [
  ["+ ", "created"],
  ["~ ", "changed"],
  ["- ", "removed"],
  ["! ", "warn"],
];

/**
 * A line written with its mark in front (`+ ~/.claude/settings.json: …`), as the mark and the
 * words, so `Out.line` can draw the mark: colour, the old console's ASCII, wrapping. Null for a
 * line with no such mark, or with a newline in it (printed as it is).
 */
export function leadingMark(line: string): { mark: Mark; text: string } | null {
  if (line.includes("\n")) return null;
  for (const [prefix, mark] of LEADING_MARKS) {
    if (line.startsWith(prefix)) return { mark, text: line.slice(prefix.length) };
  }
  return null;
}

/** The frames of the progress line: braille dots, or a turning bar on an old console. */
const FRAMES_UNICODE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAMES_ASCII = ["|", "/", "-", "\\"];
/** How often the progress line turns. */
const FRAME_MS = 80;
/** Back to the start of the line, and clear it. */
const CLEAR_LINE = "\r\x1b[2K";

export interface Out {
  readonly term: Terminal;
  /** A title line, bold on a colour terminal. */
  heading(text: string): void;
  blank(): void;
  /** Plain words, wrapped, with `indent` spaces before each line. */
  say(text: string, indent?: number): void;
  /** One marked line, and its `Fix:` under it. */
  line(mark: Mark, text: string, options?: LineOptions): void;
  group(header: GroupHeader, lines: GroupLine[]): void;
  verdict(mark: Mark, text: string): void;
  /** "Next steps", numbered: what the person does after this command. */
  next(steps: readonly string[]): void;
  /**
   * Runs a slow step. On a rich terminal a turning mark and the label stand on the line while
   * it runs, and go when it ends; plain output gets nothing (no half-lines in a log). A step
   * that runs synchronous code shows a still mark: the label is what matters.
   */
  progress<T>(label: string, work: () => Promise<T>): Promise<T>;
  /** The value as JSON, two spaces deep, for a program to read. */
  json(value: unknown): void;
  /**
   * Lines that carry their mark in front (`+ `, `~ `, `- `, `! `), each drawn with `line`; a line
   * with none is printed as it is. How `setup` prints its report until its lines are data.
   */
  marked(lines: readonly string[]): void;
}

/**
 * Where an `Out` prints: whole lines, and the raw text of the progress line (which has no
 * newline and is drawn over itself).
 */
export interface Sink {
  line(text: string): void;
  raw(text: string): void;
}

/**
 * The process's own stdout. Lines go through `console.log`, the way every command printed before
 * this module, so a test that captures `console.log` reads them; the progress line is written
 * raw, because `console.log` would end it with a newline.
 */
export const CONSOLE_SINK: Sink = {
  line: (text) => console.log(text),
  raw: (text) => {
    process.stdout.write(text);
  },
};

/** A sink that hands all of its text to one function: a test's collector, say. */
export function textSink(write: (text: string) => void): Sink {
  return { line: (text) => write(`${text}\n`), raw: write };
}

export function createOut(term: Terminal, sink: Sink = CONSOLE_SINK): Out {
  const print = (lines: string[]) => {
    for (const line of lines) sink.line(line);
  };
  const write = (text: string) => sink.raw(text);
  return {
    term,
    heading(text) {
      const shown = words(term, text);
      print([term.color ? `\x1b[1m${shown}\x1b[0m` : shown]);
    },
    blank() {
      sink.line("");
    },
    say(text, indent = 0) {
      const pad = " ".repeat(indent);
      print(
        wrapWords(words(term, text), term.width - indent, term.width - indent).map(
          (part) => `${pad}${part}`,
        ),
      );
    },
    line(mark, text, options) {
      print(renderLine(term, mark, text, options));
    },
    group(header, lines) {
      print(renderGroup(term, header, lines));
    },
    verdict(mark, text) {
      print(renderVerdict(term, mark, text));
    },
    next(steps) {
      if (steps.length === 0) return;
      print(["Next steps:"]);
      const number = (index: number) => `${index + 1}.`.padEnd(String(steps.length).length + 2);
      for (const [index, step] of steps.entries()) {
        const lead = `  ${number(index)}`;
        const room = term.width - lead.length;
        print(
          wrapWords(words(term, step), room, room).map((part, at) =>
            at === 0 ? `${lead}${part}` : `${" ".repeat(lead.length)}${part}`,
          ),
        );
      }
    },
    async progress(label, work) {
      if (!term.rich) return work();
      const frames = term.unicode ? FRAMES_UNICODE : FRAMES_ASCII;
      const text = words(term, label);
      let frame = 0;
      const draw = () => {
        write(`${CLEAR_LINE}${frames[frame % frames.length]} ${text}`);
        frame += 1;
      };
      draw();
      const timer = setInterval(draw, FRAME_MS);
      timer.unref?.();
      try {
        return await work();
      } finally {
        clearInterval(timer);
        write(CLEAR_LINE);
      }
    },
    json(value) {
      sink.line(JSON.stringify(value, null, 2));
    },
    marked(lines) {
      for (const line of lines) {
        const found = leadingMark(line);
        if (found === null) sink.line(words(term, line));
        else print(renderLine(term, found.mark, found.text));
      }
    },
  };
}
