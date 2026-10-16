/**
 * Reads a shell command line (Bash, and PowerShell's quoting) as the commands it RUNS.
 *
 * A check that asks "does this line run that program?" must never mistake text for a
 * command: a word in quotes, a here-doc body, a comment. Otherwise a guard stops a commit
 * whose message names a tool, or a `grep` for it.
 *
 * What is text, not a command:
 *   - `'…'`, `"…"`, `$'…'`, and a PowerShell here-string `@"…"@`;
 *   - a here-doc body (`<<EOF`, `<<-'EOF'` … up to its closing line);
 *   - a `#` comment that starts a word.
 * What is a command even inside quotes: `$( … )` in a double-quoted string (depth-tracked,
 * with its own quotes and here-docs: the `git commit -m "$(cat <<'EOF' … EOF)"` idiom).
 * Not read: a backtick substitution, `xargs`, `ssh`, or a script file.
 *
 * A backslash escapes only a quote, a backslash or a backtick (and `$` inside double
 * quotes): in a Windows path, `D:\;` still ends the command. In PowerShell the backtick
 * escapes the same way.
 *
 * Pure: no file, no environment, no process.
 */

/** How many `bash -c "bash -c …"` levels a caller reads. */
export const MAX_NESTING = 3;

/** Where a command ends: `;` `&&` `||` `|` `&` a new line, and the braces of `if (…) { … }`. */
const SEPARATORS = new Set(["\n", "\r", "&", "(", ")", ";", "{", "|", "}"]);

/** A `\` or a backtick at the end of a line: the line goes on in the next. */
const CONTINUATION = /[\\`][ \t]*\r?\n/y;

/** `<<WORD`, `<<-'WORD'`, `<<"WORD"`: group 1 is `-` (tabs stripped), the rest the word. */
const HERE_DOC = /<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([^\s"'<>;&|()]+))/y;

/** A PowerShell here-string: `@"`, a line break, any lines, then `"@` at a line's start. */
const HERE_STRING = /@(["'])\r?\n[\s\S]*?\r?\n\1@/y;

interface Lexed {
  /** A quote or a here-doc that never closes: what follows is text, or not read at all. */
  open: boolean;
  segments: string[];
}

interface LexOptions {
  /** Ignore quotes, escapes, comments and `$( )`: only closed here-docs are cut. */
  blind: boolean;
  /** Glue a line that ends in `\` or a backtick to the next one. */
  join: boolean;
}

/** One pass over `text`, cutting it into the commands it runs. */
function lex(text: string, { blind, join }: LexOptions): Lexed {
  const segments: string[] = [];
  const owed: { stripTabs: boolean; word: string }[] = [];
  let open = false;
  let at = 0;

  /** Just past a line break: step over the body of each here-doc that line opened. */
  function skipBodies(): void {
    for (const { stripTabs, word } of owed.splice(0)) {
      let line = at;
      let closedAt = -1;
      while (line < text.length) {
        const end = text.indexOf("\n", line);
        const stop = end === -1 ? text.length : end;
        const content = text.slice(line, stop).replace(/\r$/, "");
        if ((stripTabs ? content.replace(/^\t+/, "") : content) === word) {
          closedAt = Math.min(stop + 1, text.length);
          break;
        }
        line = stop + 1;
      }
      if (closedAt !== -1) {
        at = closedAt;
      } else if (!blind) {
        // The body runs to the end, and nothing in it is a command.
        open = true;
        at = text.length;
      }
    }
  }

  /**
   * The index after the `))` that closes the `$((` whose second `(` is at `from`, or -1
   * when it is no arithmetic: it must start `((`, end `))` and hold no `;`. Otherwise it is
   * `$( (subshell) … )`, whose commands are read.
   */
  function arithmeticEnd(from: number): number {
    if (text.charAt(from + 1) !== "(") return -1;
    let depth = 0;
    for (let i = from; i < text.length; i++) {
      if (text.charAt(i) === "(") depth++;
      else if (text.charAt(i) === ")" && --depth === 0) {
        const closes = text.charAt(i - 1) === ")" && i - 1 > from + 1;
        return closes && !text.slice(from, i).includes(";") ? i + 1 : -1;
      }
    }
    return -1;
  }

  /** `'…'` at `at`; `ansi` (`$'…'`) lets a backslash escape the closing quote. */
  function readSingle(ansi: boolean): string {
    let end = at + 1;
    while (end < text.length && text.charAt(end) !== "'") {
      end += ansi && text.charAt(end) === "\\" ? 2 : 1;
    }
    if (end >= text.length) open = true;
    const piece = text.slice(at, end + 1);
    at = Math.min(end + 1, text.length);
    return piece;
  }

  /** `"…"` at `at`; the commands of its `$( … )` become segments of their own. */
  function readDouble(): string {
    const mark = segments.length;
    let raw = '"';
    at++;
    while (at < text.length) {
      const char = text.charAt(at);
      const next = text.charAt(at + 1);
      if (char === '"') {
        at++;
        return raw + char;
      }
      if (
        (char === "\\" || char === "`") &&
        (next === '"' || next === "'" || next === char || (char === "\\" && next === "$"))
      ) {
        raw += char + next;
        at += 2;
      } else if (char === "$" && next === "(") {
        const end = arithmeticEnd(at + 1);
        if (end === -1) {
          at += 2;
          raw += `$(${read(true)}`;
        } else {
          raw += text.slice(at, end);
          at = end;
        }
      } else {
        raw += char;
        at++;
      }
    }
    // Never closed: nothing inside it ran.
    open = true;
    segments.length = mark;
    return raw;
  }

  /**
   * Reads commands to the end of the text, or (`nested`) to the `)` that closes a `$(`.
   * Returns the text read, bodies cut: what the enclosing quoted word holds.
   */
  function read(nested: boolean): string {
    let raw = "";
    let current = "";
    let depth = 0;
    const take = (piece: string) => {
      current += piece;
      raw += piece;
    };
    while (at < text.length) {
      const char = text.charAt(at);
      const next = text.charAt(at + 1);
      if (join && (char === "\\" || char === "`")) {
        CONTINUATION.lastIndex = at;
        if (CONTINUATION.test(text)) {
          take(" ");
          at = CONTINUATION.lastIndex;
          continue;
        }
      }
      if (!blind) {
        if ((char === "\\" || char === "`") && (next === '"' || next === "'" || next === char)) {
          take(char + next);
          at += 2;
          continue;
        }
        if (char === "'") {
          take(readSingle(false));
          continue;
        }
        if (char === '"') {
          take(readDouble());
          continue;
        }
        if (char === "$" && next === "'") {
          at++;
          take(`$${readSingle(true)}`);
          continue;
        }
        const arithmetic = char === "$" && next === "(" ? arithmeticEnd(at + 1) : -1;
        if (arithmetic !== -1) {
          take(text.slice(at, arithmetic));
          at = arithmetic;
          continue;
        }
        if (char === "#" && (at === 0 || /[\s;&|(]/.test(text.charAt(at - 1)))) {
          const end = text.indexOf("\n", at);
          at = end === -1 ? text.length : end;
          continue;
        }
      }
      if (char === "<" && next === "<") {
        HERE_DOC.lastIndex = at;
        const opener = HERE_DOC.exec(text);
        const word = opener?.[2] ?? opener?.[3] ?? opener?.[4];
        if (opener !== null && word !== undefined) {
          owed.push({ stripTabs: opener[1] === "-", word });
          take(opener[0]);
          at = HERE_DOC.lastIndex;
        } else {
          take("<<");
          at += 2;
        }
        continue;
      }
      if (char === "@" && (next === '"' || next === "'")) {
        HERE_STRING.lastIndex = at;
        if (HERE_STRING.exec(text) !== null) {
          take(`${next}${next}`);
          at = HERE_STRING.lastIndex;
          continue;
        }
      }
      if (SEPARATORS.has(char)) {
        if (nested && char === ")" && depth === 0) {
          segments.push(current);
          at++;
          return `${raw})`;
        }
        if (nested && char === "(") depth++;
        if (nested && char === ")") depth--;
        segments.push(current);
        current = "";
        raw += char;
        at++;
        if (char === "\n") skipBodies();
        continue;
      }
      take(char);
      at++;
    }
    // The end of the text. A `$(` that never closed: `readDouble` marks its quote open.
    segments.push(current);
    return raw;
  }

  read(false);
  return { open, segments };
}

export interface SegmentOptions {
  /**
   * When a quote never closes, split on every separator instead, so nothing hides in it
   * (more pieces). A guard wants that; a check for something that RAN does not.
   */
  blindWhenOpen?: boolean;
  /** A line that ends in `\` or a backtick goes on in the next one. */
  joinLines?: boolean;
}

/**
 * The commands of a shell line, one string each, in order. Every `$( … )` inside a double
 * quote adds its commands, and the quoted word that holds it stays in its command, whole.
 */
export function shellSegments(command: string, options: SegmentOptions = {}): string[] {
  const join = options.joinLines ?? false;
  const read = lex(command, { blind: false, join });
  if (read.open && options.blindWhenOpen === true) {
    return lex(command, { blind: true, join }).segments;
  }
  return read.segments;
}

/** Words before the program that start no other program of their own. */
const PREFIX_WORDS = new Set(["builtin", "command", "env", "exec", "nohup", "sudo", "time"]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;

/**
 * The words of one command, with the quotes AROUND a piece removed: `-m "a b"` gives
 * `-m`, `a b`; `-c 'echo "x; y"'` gives `-c`, `echo "x; y"`. The inner quotes stay, so a
 * `bash -c` word can be read again as a command line. In double quotes, `\"` and `\\`
 * lose their backslash.
 */
export function wordsOf(segment: string): string[] {
  const words = segment.match(/(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s"'])+/g) ?? [];
  return words.map((word) =>
    word.replace(/"((?:\\.|[^"\\])*)"|'([^']*)'/g, (_, double: string | undefined, single) =>
      double === undefined ? String(single) : double.replace(/\\(["\\$`])/g, "$1"),
    ),
  );
}

/** The program of a command (no folder, no `.exe`), and its arguments. */
export function invocationOf(words: string[]): { args: string[]; program: string } | undefined {
  let index = 0;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (!ASSIGNMENT.test(word) && !PREFIX_WORDS.has(word)) break;
    index++;
  }
  const first = words[index];
  if (first === undefined) return undefined;
  const program = (first.split(/[\\/]/).pop() ?? first)
    .toLowerCase()
    .replace(/\.(exe|cmd|ps1|bat)$/, "");
  return { args: words.slice(index + 1), program };
}

/**
 * The command line a shell wrapper runs, when it comes as one word or the rest of the
 * line: `bash -c "…"`, `cmd /c …`, `pwsh -Command "…"`, `iex "…"`, `eval "…"`.
 */
export function nestedCommand(program: string, args: string[]): string | undefined {
  if (["bash", "dash", "sh", "zsh"].includes(program)) {
    const at = args.findIndex((arg) => /^-[a-z]*c$/.test(arg));
    return at === -1 ? undefined : args[at + 1];
  }
  if (program === "cmd") {
    const at = args.findIndex((arg) => /^\/[ck]$/i.test(arg));
    return at === -1 ? undefined : args.slice(at + 1).join(" ");
  }
  if (program === "powershell" || program === "pwsh") {
    // PowerShell takes any prefix of a parameter name: -c, -com, -Command.
    const at = args.findIndex((arg) => arg.length > 1 && "-command".startsWith(arg.toLowerCase()));
    return at === -1 ? undefined : args.slice(at + 1).join(" ");
  }
  if (program === "eval" || program === "iex" || program === "invoke-expression") {
    return args.join(" ");
  }
  return undefined;
}
