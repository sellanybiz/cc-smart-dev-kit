/**
 * The one lexer the Agent guard reads a Workflow script with (`agent-guard.ts`): which parts of
 * the text are code, and where each string, template, comment and regular expression that
 * starts in code ends. Every scanner of a script (the `agent`/`workflow` mentions, a call's end,
 * its options, its arguments) reads the text through it, so no two of them can disagree on what
 * is a string.
 *
 * It is a lexer, not a parser. The one hard part of JavaScript's lexing is the `/`: a division,
 * or the start of a regular expression (`s.replace(/"/g, "'")`)? Read wrong, a quote inside a
 * regular expression opens a string that swallows the code after it, and a launch disappears
 * from the guard's view. So the lexer decides it the way JavaScript's own grammar does, from
 * the token before the `/`:
 *   - a regular expression where an expression starts: at the start of the text, after
 *     punctuation (`( , = : [ ! & | ? ; + - * % < > ~ ^`, `=>`), after a block's `}`, after
 *     the `)` of an `if`/`while`/`for`/`with` head, and after a word such as `return` or
 *     `typeof` (`REGEX_AFTER_WORDS`);
 *   - a division after a value: a name, a number, a literal, a `)`, a `]`, an object's `}`.
 * A regular expression must close on its own line. What does not close — a regular expression,
 * a string, a block comment, a template, a `${…}` — is a text the lexer cannot read, and the
 * guard refuses the Workflow rather than guess (`lexScript` answers `ok: false`).
 *
 * A template's `${…}` is code again, to any depth: a backtick inside it starts a new template.
 */

/** Words after which a `/` starts a regular expression, and a `{` an object. */
const REGEX_AFTER_WORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

/** Words whose `( … )` heads a statement: a `/` after its `)` starts a regular expression. */
const HEAD_WORDS = new Set(["for", "if", "while", "with"]);

/** The token before the current one, in one code frame: what decides a `/` and a `{`. */
type Last =
  | { kind: "start" }
  | { kind: "punct"; char: string }
  | { kind: "word"; word: string }
  | { kind: "value" }
  | { kind: "close-head" }
  | { kind: "close-paren" }
  | { kind: "close-block" }
  | { kind: "close-object" };

/** A run of code: the whole text, or one `${…}` of a template. */
interface CodeFrame {
  braces: Array<"block" | "object">;
  kind: "code";
  last: Last;
  /** For each open `(`: true when a head word (`if`, `while`, …) came before it. */
  parens: boolean[];
}

/** An open template: where its backtick is. */
interface TemplateFrame {
  kind: "template";
  start: number;
}

/** A script as the lexer reads it. */
export interface ScriptLex {
  /**
   * True at each index of code: outside strings, comments, regular expressions and a
   * template's text, and inside a template's `${…}`.
   */
  code: Uint8Array;
  /**
   * Where each string, template, comment and regular expression that starts in code ends (the
   * index after it). A template is one unit, its `${…}` included.
   */
  ends: Map<number, number>;
}

/** The lexer's answer: the script, or where and why it cannot be read. */
export type Lexed = { lex: ScriptLex; ok: true } | { at: number; ok: false; why: string };

/** True when a `/` after `last` starts a regular expression. */
function regexAfter(last: Last): boolean {
  switch (last.kind) {
    case "start":
    case "punct":
    case "close-head":
    case "close-block":
      return true;
    case "word":
      return REGEX_AFTER_WORDS.has(last.word);
    default:
      return false;
  }
}

/** True when a `{` after `last` opens a block (a statement), not an object literal. */
function blockAfter(last: Last): boolean {
  switch (last.kind) {
    case "start":
    case "close-head":
    case "close-paren":
    case "close-block":
    case "close-object":
    case "value":
      return true;
    case "punct":
      return last.char === ";" || last.char === "{" || last.char === "=>";
    case "word":
      return !REGEX_AFTER_WORDS.has(last.word);
  }
}

/** The end of a quoted string that starts at `from`; null when it does not close on its line. */
function stringEnd(text: string, from: number): null | number {
  const quote = text[from];
  for (let index = from + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") index += 1;
    else if (char === quote) return index + 1;
    else if (char === "\n") return null;
  }
  return null;
}

/** The end of a regular expression that starts at `from`, with its flags; null when it does not close on its line. */
function regexEnd(text: string, from: number): null | number {
  let inClass = false;
  for (let index = from + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\n" || char === "\r") return null;
    if (char === "\\") {
      // An escape never reaches past the line: a regular expression holds no line break.
      if (text[index + 1] === "\n" || text[index + 1] === "\r") return null;
      index += 1;
    } else if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) {
      let end = index + 1;
      while (/[A-Za-z]/.test(text[end] ?? "")) end += 1;
      return end;
    }
  }
  return null;
}

/** True for a character that continues a name or a number. */
function wordChar(char: string): boolean {
  return /[\w$]/.test(char) || char.charCodeAt(0) > 0x7f;
}

/** Reads a script (`ScriptLex`), or says where and why it cannot. */
export function lexScript(text: string): Lexed {
  const code = new Uint8Array(text.length);
  const ends = new Map<number, number>();
  const root: CodeFrame = { braces: [], kind: "code", last: { kind: "start" }, parens: [] };
  const stack: Array<CodeFrame | TemplateFrame> = [root];
  const fail = (at: number, why: string): Lexed => ({ at, ok: false, why });
  /** Marks `[from, to)` as one unit that is not code, ending a token of value. */
  const unit = (frame: CodeFrame, from: number, to: number) => {
    ends.set(from, to);
    frame.last = { kind: "value" };
  };

  for (let index = 0; index < text.length; index += 1) {
    const frame = stack.at(-1) ?? root;
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";

    if (frame.kind === "template") {
      if (char === "\\") {
        index += 1;
      } else if (char === "`") {
        stack.pop();
        const parent = stack.at(-1);
        if (parent?.kind === "code") unit(parent, frame.start, index + 1);
      } else if (char === "$" && next === "{") {
        stack.push({ braces: [], kind: "code", last: { kind: "start" }, parens: [] });
        index += 1;
      }
      continue;
    }

    if (/\s/.test(char)) {
      code[index] = 1;
      continue;
    }
    if (char === "/" && next === "/") {
      const newline = text.indexOf("\n", index);
      const end = newline === -1 ? text.length : newline;
      ends.set(index, end);
      index = end - 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const close = text.indexOf("*/", index + 2);
      if (close === -1) return fail(index, "a block comment that never closes");
      ends.set(index, close + 2);
      index = close + 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const end = stringEnd(text, index);
      if (end === null) return fail(index, "a string that does not close on its line");
      unit(frame, index, end);
      index = end - 1;
      continue;
    }
    if (char === "`") {
      stack.push({ kind: "template", start: index });
      continue;
    }
    if (char === "/" && regexAfter(frame.last)) {
      const end = regexEnd(text, index);
      if (end === null) {
        return fail(
          index,
          "a `/` that starts a regular expression, which does not close on its line",
        );
      }
      unit(frame, index, end);
      index = end - 1;
      continue;
    }

    code[index] = 1;
    if (wordChar(char)) {
      let end = index + 1;
      while (end < text.length && wordChar(text[end] ?? "")) end += 1;
      const word = text.slice(index, end);
      code.fill(1, index, end);
      frame.last = /^[0-9]/.test(word) ? { kind: "value" } : { kind: "word", word };
      index = end - 1;
      continue;
    }
    if (char === "(") {
      frame.parens.push(frame.last.kind === "word" && HEAD_WORDS.has(frame.last.word));
      frame.last = { char, kind: "punct" };
    } else if (char === ")") {
      frame.last = { kind: frame.parens.pop() === true ? "close-head" : "close-paren" };
    } else if (char === "]") {
      frame.last = { kind: "value" };
    } else if (char === "{") {
      frame.braces.push(blockAfter(frame.last) ? "block" : "object");
      frame.last = { char, kind: "punct" };
    } else if (char === "}") {
      if (frame.braces.length === 0 && stack.length > 1) {
        // The `}` that ends a template's `${…}`: back to the template's text.
        code[index] = 0;
        stack.pop();
        continue;
      }
      frame.last = { kind: frame.braces.pop() === "object" ? "close-object" : "close-block" };
    } else if (char === "=" && next === ">") {
      code[index + 1] = 1;
      frame.last = { char: "=>", kind: "punct" };
      index += 1;
    } else {
      frame.last = { char, kind: "punct" };
    }
  }
  const open = stack.at(-1);
  if (open?.kind === "template") return fail(open.start, "a template that never closes");
  if (stack.length > 1) return fail(text.length, "a template's `${` that never closes");
  return { lex: { code, ends }, ok: true };
}
