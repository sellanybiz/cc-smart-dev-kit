/**
 * The one way a command asks a person: a yes/no question (`confirm`), a question with a default
 * (`ask`), and a secret read with no echo (`secret`). Every command that asks builds its
 * questions here, so they all look and behave the same:
 *
 * - **The default is shown**, and Enter takes it: `[y/N]` (no) or `[Y/n]` (yes) for a yes/no
 *   question, `[main]` for a question with an answer already filled in.
 * - **An answer that is not understood is asked again, once**, with what is wrong. A second one
 *   takes the default, and says so. So a run never loops on a question.
 * - **The end of the input takes the default** (Ctrl+D, or a terminal that went away), so a run
 *   never hangs on a question. Ctrl+C at a typed question ends the command (exit 130, the
 *   shell's own signal exit); at the secret read it answers null, and the caller says it stopped.
 * - **No terminal, no questions.** `terminalPrompts` answers null when stdin is not a terminal
 *   (a pipe, a script, CI, a test): the caller then takes the default, or refuses and names the
 *   flag that answers the question.
 * - **A secret never echoes and is never printed or logged.** It is read in raw mode
 *   (`readSecretLine`), and only where the terminal can switch its echo off (`canHideInput`):
 *   elsewhere `secret` is null and the caller names the `--…-stdin` flag.
 *
 * Drawn like everything else the CLI prints (`out.ts`): the same words in rich and plain mode,
 * ASCII on an old Windows console, a long question wrapped to the width on a terminal.
 */
import { canHideInput, type RawTerminal, readSecretLine } from "../secret-line";
import { renderLine, shownText, wrapWords } from "./out";
import type { Terminal } from "./terminal";

/** Where a question is shown and its answer read. The real one is the terminal; a test fakes it. */
export interface PromptIO {
  /** Prints text as it is, with no newline added. */
  write(text: string): void;
  /**
   * Shows `shown` and one space, then reads the line the person types (the terminal echoes it).
   * Null for an empty line, and at the end of the input: both take the default.
   */
  readLine(shown: string): string | null;
  /**
   * One line read with no echo, cleaned (`readSecretLine`); null at Ctrl+C. Left out when the
   * terminal cannot switch its echo off.
   */
  readSecret?: () => Promise<string | null>;
}

/** What a question with a default may check about an answer. */
export interface AskOptions {
  /** The answer Enter gives; shown in brackets when it is not empty. */
  default: string;
  /**
   * Why an answer is not understood (`"prefix=base" pairs only`), or null when it is. The
   * default is never checked: it comes from the project or the flags, already checked.
   */
  check?: (answer: string) => string | null;
}

export interface Prompts {
  /** A yes/no question; `fallback` is the default (no, unless given). */
  confirm(question: string, fallback?: boolean): boolean;
  /** A question with a default: the trimmed answer, or the default. */
  ask(question: string, options: AskOptions): string;
  /**
   * Reads a secret with no echo: the text, or null at Ctrl+C. Null itself when this terminal
   * cannot hide what is typed: the caller then names the flag that reads it from stdin.
   */
  readonly secret: ((question: string) => Promise<string | null>) | null;
}

/**
 * The exit code of a command the person stopped with Ctrl+C: 128 + SIGINT, the shell's own. A
 * typed question gets it from the signal itself; a command whose secret read answered null
 * returns it, so both ways end alike.
 */
export const INTERRUPTED_EXIT = 130;

/** How many times a question is asked when the answers are not understood. */
const TRIES = 2;

/** "yes" or "no" in the words a person types; undefined when it is neither. */
function yesOrNo(answer: string): boolean | undefined {
  const word = answer.trim().toLowerCase();
  if (word === "y" || word === "yes") return true;
  if (word === "n" || word === "no") return false;
  return undefined;
}

const DIM = 2;

export function createPrompts(term: Terminal, io: PromptIO): Prompts {
  const hint = (text: string) => (term.color ? `\x1b[${DIM}m${text}\x1b[0m` : text);
  /** The question's lines but its last are printed; the last is shown with the hint, and read. */
  const read = (question: string, hintText: string): string | null => {
    const room = Math.max(1, term.width - (hintText === "" ? 0 : hintText.length + 1) - 1);
    const lines = wrapWords(shownText(term, question), room, room);
    for (const line of lines.slice(0, -1)) io.write(`${line}\n`);
    const last = lines.at(-1) ?? "";
    return io.readLine(hintText === "" ? last : `${last} ${hint(hintText)}`);
  };
  const say = (text: string) => {
    for (const line of renderLine(term, "warn", text)) io.write(`${line}\n`);
  };
  const yesNoWord = (value: boolean) => (value ? "yes" : "no");
  return {
    confirm(question, fallback = false) {
      for (let attempt = 1; attempt <= TRIES; attempt += 1) {
        const answer = read(question, fallback ? "[Y/n]" : "[y/N]");
        if (answer === null || answer.trim() === "") return fallback;
        const understood = yesOrNo(answer);
        if (understood !== undefined) return understood;
        if (attempt < TRIES) {
          say(`Not understood: answer y or n (Enter keeps ${yesNoWord(fallback)}).`);
        }
      }
      say(`Not understood again: ${yesNoWord(fallback)}, the default.`);
      return fallback;
    },
    ask(question, options) {
      const shownDefault = options.default === "" ? "" : `[${options.default}]`;
      for (let attempt = 1; attempt <= TRIES; attempt += 1) {
        const typed = read(question, shownDefault);
        const answer = typed === null || typed.trim() === "" ? options.default : typed.trim();
        if (answer === options.default) return answer;
        const problem = options.check?.(answer) ?? null;
        if (problem === null) return answer;
        say(
          attempt < TRIES
            ? `Not understood: ${problem}.`
            : `Not understood again (${problem}): ${options.default === "" ? "none" : options.default}, the default.`,
        );
      }
      return options.default;
    },
    secret:
      io.readSecret === undefined
        ? null
        : async (question) => {
            io.write(`${shownText(term, question)} ${hint("(it is not shown)")} `);
            const value = await io.readSecret?.();
            // Enter is not echoed in raw mode: the next line starts here.
            io.write("\n");
            return value ?? null;
          },
  };
}

/** A terminal's stdin, as `terminalPrompts` needs it. */
type Stdin = RawTerminal & { isTTY?: boolean };

/**
 * The prompts of this process's terminal, or null when stdin is not one: then nothing is asked.
 * A typed line is read with Bun's own `prompt` (it shows the question and a space, and reads
 * one line); a secret with `readSecretLine`, only where the echo can be switched off.
 */
export function terminalPrompts(
  term: Terminal,
  stdin: Stdin = process.stdin,
  write: (text: string) => void = (text) => {
    process.stdout.write(text);
  },
): Prompts | null {
  if (stdin.isTTY !== true) return null;
  return createPrompts(term, {
    write,
    readLine: (shown) => prompt(shown),
    ...(canHideInput(stdin) ? { readSecret: () => readSecretLine(stdin) } : {}),
  });
}
