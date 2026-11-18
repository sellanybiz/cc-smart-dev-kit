/**
 * Reads a shell command line as the commands it RUNS. This is the one reader of a shell line
 * in the plugin: the git guard (`src/hooks/git-guard.ts`), the merge reader
 * (`src/hooks/after-merge.ts`, which the merge guard reads through), job-route
 * (`src/hooks/job-route.ts`), the job classifier (`src/jobs/classify.ts`) and `job run`
 * (`src/jobs/run.ts`) all read a line here, so a line means the same to each of them.
 *
 * A check that asks "does this line run that program?" must never mistake text for a
 * command — a word in quotes, a quoted here-doc body, a comment — or a guard asks about a
 * commit message and the queue routes a `grep`. And it must never miss a command the shell
 * really runs: that is how a guard is passed by.
 *
 * **Two dialects**, because Claude Code has two shell tools, and the hook input's `tool_name`
 * says which one runs the line (`dialectOfTool`): `Bash` (bash; Git Bash on Windows) and
 * `PowerShell`. They quote in different ways, so a line is read in its own tool's dialect.
 * A guard that is not told the tool reads the line both ways (`readingsOf`), so a command
 * either shell would run is found.
 *
 * Bash:
 *   - text: `'…'`, `$'…'`, the body of a here-doc whose word is quoted (`<<'EOF'`, `<<"EOF"`,
 *     `<<\EOF`), and a `#` comment that starts a word;
 *   - a command even inside text: `$( … )` and `` `…` `` in a double-quoted string, in the
 *     body of a here-doc whose word is not quoted (`<<EOF`), and in `$(( … ))`: bash runs
 *     them all (the `git commit -m "$(cat <<'EOF' … EOF)"` idiom is read this way);
 *   - outside quotes a backslash escapes the character after it (`\;` is no separator, and
 *     `g\it` is `git`); inside double quotes only `$`, a backtick, `"`, `\` and a line break;
 *   - `{` and `}` group commands only as words of their own (`{ a; }`): `HEAD@{0}` is one word.
 * PowerShell:
 *   - text: `'…'` (`''` is a quote inside it), `@'…'@`, a `#` comment that starts a word, and
 *     a `<# … #>` block comment; the typographic quotes (`‘ ’ ‚ ‛`, `“ ” „`) quote like `'`
 *     and `"`, as PowerShell reads them;
 *   - a command even inside text: `$( … )` in `"…"` and in `@"…"@`;
 *   - the backtick escapes the character after it, and a backslash is a plain character:
 *     `"C:\repo\"` ends at its last quote;
 *   - every brace ends a command: `{ … }` is a script block, which `&`, `.` or `%` runs;
 *   - `--%` hands the rest of the line to the program as it is;
 *   - a `<` outside a string and a comment is a parse error ("reserved for future use"), and
 *     PowerShell runs nothing of a script it cannot parse: so a bash here-doc read this way
 *     runs nothing either, and a guard that reads both ways asks nothing about its body.
 * Both: a shell keyword, a redirection, or a wrapper and its options is stepped over to reach
 * the command it stands before (`invocationOf`). A shell that reads its script from standard
 * input (`sh`, `bash -s`, `… | sh`) has its here-doc body, its here-string, or the text piped
 * from the command before it read as command lines. The inner line of `bash -c`, `cmd /c`,
 * `pwsh -Command`, `eval`, `iex` and `cc-smart-dev-kit job run -- …` is a line of its own
 * (`nestedCommand`), read in its own dialect (`nestedDialect`), three levels deep.
 *
 * Not read: brace expansion (`{git,push}`), `-EncodedCommand`, `ssh`, a script file; `cmd /c`
 * is read with Bash's quoting. **A program named at run time** (`$GIT`, `$(which git)`, a
 * backtick) is read as what it is: `invocationOf` marks it `computed`, and a guard whose
 * domain words are in that command asks about it rather than let it through unseen.
 *
 * Pure: no file, no environment, no process.
 */
import { kitArguments } from "./kit-invocation";
import { powershellQuoted } from "./powershell";
import { programName } from "./program-name";
import { shellQuote } from "./quote";

/** The shell a line is written for: Claude Code's `Bash` tool, or its `PowerShell` tool. */
export type Dialect = "bash" | "powershell";

/** The dialect of a hook input's `tool_name`, or undefined when it names neither shell tool. */
export function dialectOfTool(tool: unknown): Dialect | undefined {
  if (tool === "Bash") return "bash";
  if (tool === "PowerShell") return "powershell";
  return undefined;
}

/** Both dialects, in the order a guard that is not told the tool reads them. */
const DIALECTS: readonly Dialect[] = ["bash", "powershell"];

/** How many `bash -c "bash -c …"` levels a caller reads. */
export const MAX_NESTING = 3;

/** Each dialect's escape character. */
const ESCAPE: Record<Dialect, string> = { bash: "\\", powershell: "`" };

/** The characters that open and close a single-quoted and a double-quoted string. */
const SINGLE: Record<Dialect, string> = { bash: "'", powershell: "'\u2018\u2019\u201A\u201B" };
const DOUBLE: Record<Dialect, string> = { bash: '"', powershell: '"\u201C\u201D\u201E' };

/** True when `char` is one of `chars`. Past the end of the text `char` is "", which is none. */
const oneOf = (chars: string, char: string) => char !== "" && chars.includes(char);

/** The escape character at the end of a line: the line goes on in the next. */
const CONTINUATION: Record<Dialect, RegExp> = {
  bash: /\\[ \t]*\r?\n/y,
  powershell: /`[ \t]*\r?\n/y,
};

/** Where a command ends in both dialects: `;` `&&` `||` `|` `&` a new line, and parentheses. */
const SEPARATORS = new Set(["\n", "\r", "&", "(", ")", ";", "|"]);

/** A PowerShell here-string: `@"` or `@'`, a line break, any lines, then `"@` at a line's start. */
const HERE_STRING = /@(["'])\r?\n([\s\S]*?)\r?\n\1@/y;

/** The end of the text before a `(` that opens a bash array: `name=`, `name+=`, `-a name=`. */
const ARRAY_ASSIGNMENT = /(?:^|\s)[A-Za-z_][A-Za-z0-9_]*\+?=$/;

/** One way to read a line: its dialect, and whether a line that ends in an escape goes on. */
export interface Reading {
  dialect: Dialect;
  joinLines: boolean;
}

/**
 * Every way a guard reads `command`: in `dialect`, or in each dialect when it is not told
 * the tool; and, when a line ends in that dialect's escape, both as it is and joined to the
 * next line. A person may mean a trailing `\` as the end of a Windows path, not as a line
 * that goes on, so a guard reads both and nothing hides in either.
 */
export function readingsOf(command: string, dialect?: Dialect): Reading[] {
  const readings: Reading[] = [];
  for (const one of dialect === undefined ? DIALECTS : [dialect]) {
    readings.push({ dialect: one, joinLines: false });
    if (new RegExp(CONTINUATION[one].source).test(command)) {
      readings.push({ dialect: one, joinLines: true });
    }
  }
  return readings;
}

interface Lexed {
  /** A quote, a substitution or a here-doc that never closes: read blind to see past it. */
  open: boolean;
  /** PowerShell cannot parse the line (a bare `<`), so it runs none of it. */
  unparsable: boolean;
  segments: string[];
  /** For each segment: the text of the command it is piped from (`a | b`), else null. */
  piped: (string | null)[];
  /**
   * For each segment: the shell fills text into it before it runs, so its quotes say nothing
   * about what the program gets (the script of a here-doc with no quoted delimiter).
   */
  expanded: boolean[];
  /** For each segment: the innermost `( … )` group or substitution it is inside, else null. */
  groups: (Subshell | null)[];
  /**
   * For each segment: where its text starts in the text that was lexed, or null when the segment
   * is read out of another text (a here-doc body, a backtick, an arithmetic expansion), whose
   * offsets are not this text's.
   */
  starts: (number | null)[];
}

interface LexOptions {
  dialect: Dialect;
  /** Ignore quotes, escapes, comments and substitutions; split on every separator. */
  blind: boolean;
  /** Glue a line that ends in the dialect's escape to the next one. */
  join: boolean;
  /**
   * The text is the body of an unquoted here-doc, an arithmetic expansion or an expandable
   * here-string: only its substitutions are commands.
   */
  body?: boolean;
  /** How many texts this one is inside (a substitution's, a body's): `MAX_INNER` at most. */
  depth?: number;
  /** The group the text runs in (a substitution's, a script's): its commands are inside it. */
  outer?: Subshell | null;
}

/**
 * How deep texts inside texts are read on their own (a backtick in an arithmetic expansion
 * in a here-doc …). Deeper, the line counts as open, so a guard reads it blind — every
 * separator splits, so nothing hides — and a 64 KB line of `$((` stays fast.
 */
const MAX_INNER = 8;

/** A here-doc still owed its body: it starts after the line break that ends its line. */
interface OwedBody {
  stripTabs: boolean;
  /** A shell reads the body as its script (`sh <<'EOF'`). */
  script: boolean;
  /** The word was quoted, so the body is text: bash expands nothing in it. */
  quoted: boolean;
  word: string;
}

/** True for a character that ends a word (outside quotes). */
const isBlank = (char: string) => char === " " || char === "\t";

/** One pass over `text`, cutting it into the commands it runs. */
function lex(text: string, options: LexOptions): Lexed {
  const { blind, dialect, join } = options;
  const bash = dialect === "bash";
  const escaper = ESCAPE[dialect];
  const single = SINGLE[dialect];
  const double = DOUBLE[dialect];
  const segments: string[] = [];
  const piped: (string | null)[] = [];
  const expanded: boolean[] = [];
  const groups: (Subshell | null)[] = [];
  const starts: (number | null)[] = [];
  /** The innermost `( … )` or `$( … )` the text being read is inside. */
  let group: Subshell | null = options.outer ?? null;
  const enterGroup = (array = false) => {
    group = { depth: (group?.depth ?? 0) + 1, outer: group, ...(array ? { array } : {}) };
  };
  const leaveGroup = () => {
    // A stray `)` never leaves the group the text itself runs in.
    if (group !== (options.outer ?? null)) group = group?.outer ?? null;
  };
  /**
   * The `case … in … esac` commands open, each with the group it began in, and whether a
   * pattern comes next: a pattern's `)` ends the pattern, not a group.
   */
  const cases: { level: Subshell | null; pattern: boolean }[] = [];
  const owed: OwedBody[] = [];
  let open = false;
  let unparsable = false;
  let at = 0;
  /** Whether the segment now being read is piped from the one before it (`a | b`). */
  let afterPipe = false;
  /** Each `(`'s matching `)`, found once, for `$(( … ))` (`arithmeticEnd`). */
  let matching: Int32Array | null = null;
  /** Where each `;` is, counted up to an index: an arithmetic expansion holds none. */
  let semicolons: Int32Array | null = null;

  const push = (
    piece: string,
    from: string | null,
    filledIn = false,
    inner: Subshell | null = group,
    start: number | null = null,
  ): void => {
    segments.push(piece);
    piped.push(from);
    expanded.push(filledIn);
    groups.push(inner);
    starts.push(start);
  };

  /** Reads `inner` as text of its own and adds the commands it runs (a substitution, a script). */
  function addInner(inner: string, body: boolean, filledIn = false): void {
    const depth = (options.depth ?? 0) + 1;
    if (depth > MAX_INNER) {
      open = true;
      return;
    }
    // A substitution, a backtick or a script body runs in a shell of its own: one group in.
    const outer: Subshell = { depth: (group?.depth ?? 0) + 1, outer: group };
    const read = lex(inner, { blind, dialect, join, body: body && !blind, depth, outer });
    if (read.open) open = true;
    if (read.unparsable) unparsable = true;
    for (let i = 0; i < read.segments.length; i++) {
      push(
        read.segments[i] ?? "",
        read.piped[i] ?? null,
        filledIn || read.expanded[i] === true,
        read.groups[i] ?? outer,
      );
    }
  }

  /** Just past a line break: read or step over the body of each here-doc the line opened. */
  function skipBodies(): void {
    for (const { quoted, script, stripTabs, word } of owed.splice(0)) {
      let line = at;
      let closedAt = -1;
      let bodyEnd = text.length;
      while (line < text.length) {
        const end = text.indexOf("\n", line);
        const stop = end === -1 ? text.length : end;
        const content = text.slice(line, stop).replace(/\r$/, "");
        if ((stripTabs ? content.replace(/^\t+/, "") : content) === word) {
          closedAt = Math.min(stop + 1, text.length);
          bodyEnd = line;
          break;
        }
        line = stop + 1;
      }
      if (closedAt === -1 && blind) continue; // read blind, its lines are commands
      // A shell reads the body as its script (`sh <<'EOF' … EOF`): read it as one. An unquoted
      // body is expanded first, so its substitutions run, even with no closing line.
      if (script) {
        const body = text.slice(at, bodyEnd);
        // With no quoted delimiter the shell fills the body in first: its quotes mean nothing.
        addInner(body, false, !quoted && /[$`]/.test(body));
      } else if (!quoted) addInner(text.slice(at, bodyEnd), true);
      if (closedAt === -1) {
        open = true;
        at = text.length;
      } else {
        at = closedAt;
      }
    }
  }

  /**
   * The index after the `))` that closes the `$((` whose second `(` is at `from`
   * (`$((1<<2))`), or -1 when it is no arithmetic: it must start `((`, end `))` and hold
   * no `;`. Otherwise it is `$( (subshell) … )`, whose commands are read.
   */
  function arithmeticEnd(from: number): number {
    if (text.charAt(from + 1) !== "(") return -1;
    if (matching === null || semicolons === null) {
      matching = new Int32Array(text.length).fill(-1);
      semicolons = new Int32Array(text.length + 1);
      const stack: number[] = [];
      for (let i = 0; i < text.length; i++) {
        const char = text.charAt(i);
        semicolons[i + 1] = (semicolons[i] ?? 0) + (char === ";" ? 1 : 0);
        if (char === "(") stack.push(i);
        else if (char === ")") {
          const opened = stack.pop();
          if (opened !== undefined) matching[opened] = i;
        }
      }
    }
    const close = matching[from] ?? -1;
    if (close === -1) return -1;
    const closes = text.charAt(close - 1) === ")" && close - 1 > from + 1;
    const plain = (semicolons[close] ?? 0) === (semicolons[from] ?? 0);
    return closes && plain ? close + 1 : -1;
  }

  /** `$(( … ))` at `at`, ending at `end`: its substitutions run, the rest is a number. */
  function readArithmetic(end: number): string {
    addInner(text.slice(at + 3, end - 2), true);
    const piece = text.slice(at, end);
    at = end;
    return piece;
  }

  /** `'…'` at `at`; `ansi` (`$'…'`) lets a backslash escape the closing quote. */
  function readSingle(ansi: boolean): string {
    let end = at + 1;
    while (end < text.length) {
      const char = text.charAt(end);
      if (ansi && char === "\\") {
        end += 2;
        continue;
      }
      if (oneOf(single, char)) {
        // PowerShell: two quotes in a row are one quote inside the string (`'it''s'`).
        if (!bash && oneOf(single, text.charAt(end + 1))) {
          end += 2;
          continue;
        }
        break;
      }
      end++;
    }
    if (end >= text.length) open = true;
    const piece = text.slice(at, end + 1);
    at = Math.min(end + 1, text.length);
    return piece;
  }

  /** A bash `` `…` `` at `at`: a command substitution, whose commands are added. */
  function readBacktick(): string {
    let end = at + 1;
    while (end < text.length && text.charAt(end) !== "`") {
      end += text.charAt(end) === "\\" ? 2 : 1;
    }
    if (end >= text.length) {
      // Never closed: bash runs nothing of it.
      open = true;
      const piece = text.slice(at);
      at = text.length;
      return piece;
    }
    // Inside backticks, `\`` `\\` `\$` stand for the character itself.
    addInner(text.slice(at + 1, end).replace(/\\([`\\$])/g, "$1"), false);
    const piece = text.slice(at, end + 1);
    at = end + 1;
    return piece;
  }

  /**
   * `"…"` at `at`, the commands of its substitutions pushed as segments of their own. With
   * `closes` false the whole text is a body (an unquoted here-doc's): a quote is a character.
   */
  function readDouble(closes: boolean): string {
    const mark = segments.length;
    let raw = "";
    if (closes) {
      raw = text.charAt(at);
      at++;
    }
    while (at < text.length) {
      const char = text.charAt(at);
      const next = text.charAt(at + 1);
      if (closes && oneOf(double, char)) {
        // PowerShell: two quotes in a row are a quote inside the string (`"a""b"`).
        if (!bash && oneOf(double, next)) {
          raw += char + next;
          at += 2;
          continue;
        }
        at++;
        return raw + char;
      }
      if (char === escaper && next !== "") {
        raw += char + next;
        at += 2;
      } else if (bash && char === "$" && next === "$") {
        raw += "$$"; // the shell's process id
        at += 2;
      } else if (char === "$" && next === "(") {
        const end = bash ? arithmeticEnd(at + 1) : -1;
        if (end === -1) {
          at += 2;
          enterGroup();
          raw += `$(${read(true).raw}`;
          leaveGroup();
        } else {
          raw += readArithmetic(end);
        }
      } else if (bash && char === "`") {
        raw += readBacktick();
      } else {
        raw += char;
        at++;
      }
    }
    if (!closes) return raw;
    // Never closed: nothing inside it runs.
    open = true;
    segments.length = mark;
    piped.length = mark;
    expanded.length = mark;
    groups.length = mark;
    starts.length = mark;
    return raw;
  }

  /** A here-doc opener (`<<EOF`, `<<-'EOF'`, `<<E"O"F`) at `at`, or null when there is none. */
  function hereDocOpener(): (OwedBody & { end: number }) | null {
    let pos = at + 2;
    const stripTabs = text.charAt(pos) === "-";
    if (stripTabs) pos++;
    while (isBlank(text.charAt(pos))) pos++;
    let word = "";
    let quoted = false;
    while (pos < text.length) {
      const char = text.charAt(pos);
      if (/\s/.test(char) || "<>;&|()".includes(char)) break;
      if (char === "'" || char === '"') {
        const close = text.indexOf(char, pos + 1);
        if (close === -1) return null;
        word += text.slice(pos + 1, close);
        quoted = true;
        pos = close + 1;
      } else if (char === "\\") {
        word += text.charAt(pos + 1);
        quoted = true;
        pos += 2;
      } else {
        word += char;
        pos++;
      }
    }
    return word === "" ? null : { end: pos, quoted, script: false, stripTabs, word };
  }

  /** True when the character at `at` is a brace that groups commands, not part of a word. */
  function isGroupBrace(char: string, wordStart: boolean): boolean {
    if (char !== "{" && char !== "}") return false;
    if (!bash) return true;
    const after = text.charAt(at + 1);
    return (
      wordStart && (after === "" || /\s/.test(after) || (char === "}" && /[;&|)]/.test(after)))
    );
  }

  /**
   * Keeps track of `case … in … esac` at a separator, and says whether the separator is part of
   * a pattern (`a)`, or the `(` some write before one: `(a)`) rather than a group's parenthesis.
   * `current` is the text of the command the separator ends.
   */
  function casePattern(current: string, char: string, next: string): boolean {
    const words = current.trim();
    // `for f in a; do case $f in …`, `if case …`: a keyword that opens a list or times a
    // pipeline stands before `case`.
    const command = words.replace(
      /^(?:(?:do|then|else|elif|if|while|until|!|time(?:\s+-p)?)\s+)+/,
      "",
    );
    const level = group;
    let top = cases.at(-1);
    // `esac` ends it, also with a redirection attached (`esac>log`).
    if (top?.level === level && /^esac(?![\w-])/.test(command)) {
      cases.pop();
      top = cases.at(-1);
    }
    // `case x in esac` holds no pattern: it ends where it starts.
    const starts =
      /^case\s[\s\S]*\sin(?:\s|$)/.test(command) && !/\sin\s+esac(?![\w-])/.test(command);
    if (starts) {
      top = { level, pattern: true };
      cases.push(top);
    }
    if (top?.level !== level) return false;
    if (char === ";" && (next === ";" || next === "&")) top.pattern = true; // `;;`, `;&`, `;;&`
    if (!top.pattern) return false;
    if (char === ")") {
      top.pattern = false;
      return true;
    }
    // The `(` a pattern may start with stands right after `in` or `;;`, before any of its words.
    return char === "(" && (words === "" || (starts && /\sin$/.test(command)));
  }

  /**
   * Reads commands to the end of the text, or (`nested`) to the `)` that closes a `$(`.
   * Returns the text read, bodies cut, and whether that `)` closed it: what the enclosing
   * quoted word holds, and whether the substitution it was reading is whole. `substitutions`
   * counts the `$(` this text is inside: past `MAX_INNER` its parentheses split as plain
   * separators, so a line of 10,000 nested ones is still read in linear time (its commands
   * are still read, one level at a time).
   */
  function read(nested: boolean, substitutions = 0): { closed: boolean; raw: string } {
    let raw = "";
    let current = "";
    /** Where `current` starts in `text`: the character after the separator that ended the last one. */
    let currentStart = at;
    let depth = 0;
    /** No character of a word yet: a `#` here starts a comment, a lone `{` a group. */
    let wordStart = true;
    /**
     * Right after a `)`: `f(){ … }` opens a group there, but `$(x)#y` is one word, so a `#`
     * right after a `)` starts no comment.
     */
    let afterClose = false;
    /** Whether `current` runs a shell that reads its script from stdin (asked once). */
    let stdinShell: boolean | null = null;
    const take = (piece: string, blank = false) => {
      current += piece;
      raw += piece;
      wordStart = blank;
      afterClose = false;
    };
    while (at < text.length) {
      const char = text.charAt(at);
      const next = text.charAt(at + 1);
      if (join && char === escaper) {
        const continuation = CONTINUATION[dialect];
        continuation.lastIndex = at;
        if (continuation.test(text)) {
          take(" ", true);
          at = continuation.lastIndex;
          continue;
        }
      }
      if (!blind) {
        // A line break after the escape ends the command unless the lines are joined.
        if (char === escaper && next !== "" && next !== "\n" && next !== "\r") {
          take(char + next);
          at += 2;
          continue;
        }
        if (oneOf(single, char)) {
          take(readSingle(false));
          continue;
        }
        if (oneOf(double, char)) {
          take(readDouble(true));
          continue;
        }
        if (bash && char === "$" && next === "$") {
          // `$$` is the shell's process id: the `$` after it starts nothing (`$$'x'` is the id and
          // a plain `'x'`).
          take("$$");
          at += 2;
          continue;
        }
        if (bash && char === "$" && next === "'") {
          at++;
          take(`$${readSingle(true)}`);
          continue;
        }
        if (bash && char === "`") {
          take(readBacktick());
          continue;
        }
        const arithmetic = bash && char === "$" && next === "(" ? arithmeticEnd(at + 1) : -1;
        if (arithmetic !== -1) {
          take(readArithmetic(arithmetic));
          continue;
        }
        // `$( … )` outside quotes is part of the word it stands in (`$(which git) push` runs
        // one word and `push`): its commands are read, and the word keeps the substitution, so
        // a guard sees a program it cannot name (`invocationOf` marks it `computed`) instead of
        // the word after it. An unclosed `$(` runs nothing, and is read blind past. Past
        // `MAX_INNER` levels its parentheses split as plain separators (linear time), and the
        // commands inside are still read.
        // Bash's process substitution, `<( … )` or `>( … )` at the start of a word, is one word
        // too (the shell fills in a file name), and its commands run in a shell of their own.
        const processSubstitution = bash && (char === "<" || char === ">") && wordStart;
        if (next === "(" && (char === "$" || processSubstitution) && substitutions < MAX_INNER) {
          at += 2;
          enterGroup();
          const substitution = read(true, substitutions + 1);
          leaveGroup();
          if (!substitution.closed) open = true;
          take(`${char}(${substitution.raw}`);
          continue;
        }
        if (char === "#" && wordStart && !afterClose) {
          const end = text.indexOf("\n", at);
          at = end === -1 ? text.length : end;
          continue;
        }
        if (!bash && char === "<" && next !== "#") unparsable = true;
        if (!bash && char === "<" && next === "#" && wordStart) {
          // A PowerShell block comment: text up to `#>`, and a word break.
          const end = text.indexOf("#>", at + 2);
          if (end === -1) open = true;
          at = end === -1 ? text.length : end + 2;
          take(" ", true);
          continue;
        }
        if (!bash && wordStart && text.startsWith("--%", at) && /^\s?$/.test(text.charAt(at + 3))) {
          // PowerShell's stop-parsing token: the rest of the line goes to the program as it is.
          let end = at;
          while (end < text.length && text.charAt(end) !== "\n" && text.charAt(end) !== "|") end++;
          take(text.slice(at, end));
          at = end;
          continue;
        }
      }
      if (bash && char === "<" && next === "<") {
        if (text.charAt(at + 2) === "<") {
          take("<<<");
          at += 3;
          continue;
        }
        const opener = hereDocOpener();
        if (opener === null) {
          take("<<");
          at += 2;
          continue;
        }
        stdinShell ??= readsStdinShell(current);
        owed.push({ ...opener, script: stdinShell });
        take(text.slice(at, opener.end));
        at = opener.end;
        continue;
      }
      if (!bash && char === "@" && (next === '"' || next === "'")) {
        HERE_STRING.lastIndex = at;
        const quoted = HERE_STRING.exec(text);
        if (quoted !== null) {
          // `@"…"@` expands its `$( … )`; `@'…'@` is text.
          if (next === '"' || blind) addInner(quoted[2] ?? "", true);
          take(`${next}${next}`);
          at = HERE_STRING.lastIndex;
          continue;
        }
      }
      // `>|` is bash's clobbering redirect (`echo x >| file`), not a pipe: its `|` is part of the
      // operator, and the file after it is the redirection's target, not a command.
      if (bash && !blind && char === "|" && current.endsWith(">") && !current.endsWith("\\>")) {
        take(char);
        at++;
        continue;
      }
      // `2>&1` and `>&2` (both shells), and bash's `&>log` (both streams to a file): the `&` is
      // part of the redirection, not a separator that sends a command to the background, so
      // `tsc 2>&1 | tail` is one command piped into `tail`, never `tsc 2>` and a command `1`.
      if (
        !blind &&
        char === "&" &&
        ((current.endsWith(">") && !current.endsWith(`${escaper}>`)) || (bash && next === ">"))
      ) {
        take(char);
        at++;
        continue;
      }
      // Read blind, a bash backtick ends a command: what it holds may run.
      if (
        SEPARATORS.has(char) ||
        isGroupBrace(char, wordStart) ||
        (blind && bash && char === "`")
      ) {
        const pattern = !blind && bash ? casePattern(current, char, next) : false;
        push(
          current,
          afterPipe ? (segments[segments.length - 1] ?? null) : null,
          false,
          group,
          currentStart,
        );
        afterPipe = char === "|";
        if (!pattern && nested && char === ")" && depth === 0) {
          at++;
          return { closed: true, raw: `${raw})` };
        }
        if (!pattern && nested && char === "(") depth++;
        if (!pattern && nested && char === ")") depth--;
        // Bash's array assignment `name=( … )`, `name+=( … )`, `declare -a name=( … )`: what is
        // inside is a list of words, not commands.
        if (!pattern && char === "(") enterGroup(bash && ARRAY_ASSIGNMENT.test(current));
        else if (!pattern && char === ")") leaveGroup();
        current = "";
        stdinShell = null;
        raw += char;
        at++;
        wordStart = true;
        afterClose = char === ")";
        if (char === "\n") skipBodies();
        currentStart = at;
        continue;
      }
      take(char, isBlank(char));
      at++;
    }
    // The end of the text. A `$(` that never closed: `readDouble` marks its quote open.
    push(
      current,
      afterPipe ? (segments[segments.length - 1] ?? null) : null,
      false,
      group,
      currentStart,
    );
    return { closed: false, raw };
  }

  if (options.body === true) readDouble(false);
  else read(false);
  return { expanded, groups, open, piped, segments, starts, unparsable };
}

/** How a caller reads a line: its dialect (Bash by default), and the two switches below. */
export interface ShellOptions {
  dialect?: Dialect;
  /**
   * When a quote never closes, split on every separator instead, so nothing hides in it
   * (more pieces). A guard wants that; a check for something that RAN does not, and reads
   * the open quote as text.
   */
  blindWhenOpen?: boolean;
  /** A line that ends in the dialect's escape goes on in the next one. */
  joinLines?: boolean;
}

/**
 * A `( … )` group or a substitution of one line: the commands inside it share this object, and
 * a group inside it points back to it (`outer`). Two groups are the same only when they are one
 * object.
 */
export interface Subshell {
  /** How many groups it is inside, itself counted: 1 at the top of the line. */
  readonly depth: number;
  readonly outer: Subshell | null;
  /**
   * The group is a bash array's list (`cmd=(git push)`): its words are the array's elements, so
   * a "command" in it runs nothing and nothing may be put in front of it. Left out otherwise.
   */
  readonly array?: boolean;
}

/** One command of a shell line: its text, and the command whose output feeds it. */
export interface ShellStep {
  text: string;
  /** The text of the command this one is piped from (`a | b`), else null. */
  pipedFrom: string | null;
  /**
   * The shell fills text into this command before it runs, so its quotes say nothing about
   * what the program gets: the script of a here-doc whose delimiter is not quoted.
   */
  expanded: boolean;
  /**
   * The innermost `( … )` group or substitution the command is inside; left out at the top of
   * the line. A `cd` inside a group changes the folder only for the commands of that group, up
   * to its `)`: two groups side by side (`$(cd a) $(touch b)`) are two objects, so the second
   * does not run where the first went.
   */
  subshell?: Subshell;
  /**
   * Where `text` starts in the line this step was read from: set when the command stands in the
   * line itself, left out when it was read out of a here-doc body, a backtick or an arithmetic
   * expansion (their offsets belong to another text), and in a reading that joins escaped line
   * breaks (`joinLines`), which rewrites the text. Text before the first line break of `text`
   * is the line's own text at this offset, so a caller that edits the line at the command's first
   * word checks that against the line and leaves a line it cannot place exactly as it is: a here-doc
   * body inside a `$( … )` is cut out of `text`, and a comment skipped inside it is gone too.
   */
  start?: number;
}

/**
 * The commands of a shell line, in order, each with the command piped into it. Every
 * substitution adds its commands ahead of the command that holds it, and the word that
 * holds it stays in its command, whole.
 */
export function shellSteps(
  command: string,
  { blindWhenOpen = false, dialect = "bash", joinLines = false }: ShellOptions = {},
): ShellStep[] {
  const read = lex(command, { blind: false, dialect, join: joinLines });
  if (read.unparsable) return [];
  const chosen =
    read.open && blindWhenOpen ? lex(command, { blind: true, dialect, join: joinLines }) : read;
  return chosen.segments.map((text, index) => {
    const start = chosen.starts[index];
    return {
      expanded: chosen.expanded[index] === true,
      pipedFrom: chosen.piped[index] ?? null,
      ...(chosen.groups[index] ? { subshell: chosen.groups[index] } : {}),
      ...(typeof start === "number" && !joinLines ? { start } : {}),
      text,
    };
  });
}

/** `shellSteps`, the text of each command only. */
export function shellSegments(command: string, options: ShellOptions = {}): string[] {
  return shellSteps(command, options).map((step) => step.text);
}

/** Bash's `$'…'` escapes that stand for one character. */
const ANSI_ESCAPES: Record<string, string> = {
  a: "\x07",
  b: "\b",
  e: "\x1b",
  E: "\x1b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

/** The text of a bash `$'…'` body, its escapes decoded (`$'\x67it'` is `git`). */
function ansiText(body: string): string {
  return body.replace(
    /\\(x[0-9A-Fa-f]{1,2}|u[0-9A-Fa-f]{1,4}|U[0-9A-Fa-f]{1,8}|[0-7]{1,3}|c.|.)/gs,
    (_, code: string) => {
      const kind = code.charAt(0);
      if (kind === "x" || kind === "u" || kind === "U") {
        return String.fromCodePoint(Number.parseInt(code.slice(1), 16));
      }
      if (/[0-7]/.test(kind)) return String.fromCharCode(Number.parseInt(code, 8) & 0xff);
      if (kind === "c") return String.fromCharCode(code.charCodeAt(1) & 0x1f);
      return ANSI_ESCAPES[code] ?? code;
    },
  );
}

/** PowerShell's backtick escapes that stand for a control character. */
const POWERSHELL_ESCAPES: Record<string, string> = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  e: "\x1b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

/**
 * The words of one command, as the shell hands them to the program: the quotes AROUND a
 * piece removed (`-m "a b"` gives `-m`, `a b`; `-c 'echo "x; y"'` gives `-c`, `echo "x; y"`,
 * so a `bash -c` word can be read again as a command line), escapes resolved (`g\it` is
 * `git`, `$'\x67it'` too), and a redirection a word of its own (`main>log` is `main` and
 * `>log`; `2>x` keeps its `2`).
 */
export function wordsOf(segment: string, dialect: Dialect = "bash"): string[] {
  return wordsWithFill(segment, dialect).map((one) => one.text);
}

/** One word of a command, and whether the shell fills in part of it before the program runs. */
export interface ShellWord {
  text: string;
  /**
   * An expansion (`$x`, `${x}`, `$(…)`, `$((…))`) or a bash backtick outside single quotes: the
   * program gets the shell's answer, not this text. Single quotes, bash's `$'…'` and an escaped
   * `$` (`\$`, PowerShell's `` `$ ``) fill nothing.
   */
  filled: boolean;
}

/** The character after a `$` that starts an expansion; a lone `$` is text. */
const EXPANDS: Record<Dialect, RegExp> = {
  bash: /[A-Za-z_0-9{([@*#?$!-]/,
  powershell: /[A-Za-z_0-9{(?$^:]/,
};

/**
 * `wordsOf` with a flag on each word: does the shell fill in part of it (`ShellWord.filled`)?
 * The one lexer for both, so the quote rules have one home. A guard that reads text the shell
 * changes before the program sees it (a `$` in a `gh api` endpoint) asks this, because the
 * quotes are gone from `wordsOf`'s words: `'$n'` and `"$n"` read alike there.
 */
export function wordsWithFill(segment: string, dialect: Dialect = "bash"): ShellWord[] {
  const bash = dialect === "bash";
  const escaper = ESCAPE[dialect];
  const single = SINGLE[dialect];
  const double = DOUBLE[dialect];
  const expands = EXPANDS[dialect];
  const words: ShellWord[] = [];
  let word = "";
  let inWord = false;
  /** The word so far has a quote or an escape: it cannot be a redirection's file number. */
  let quoted = false;
  /** The word so far holds an expansion. */
  let filled = false;
  const end = () => {
    if (inWord) words.push({ text: word, filled });
    word = "";
    inWord = false;
    quoted = false;
    filled = false;
  };
  const add = (piece: string) => {
    word += piece;
    inWord = true;
  };
  /**
   * A `$` that may expand: one before an expansion's first character, or one the line reader cut
   * off from what follows (`$\<newline>P` is joined into `$ P`, PowerShell's `${x}` is cut at
   * its brace), so the word ends in a lone `$` before a space, an escape, a closing quote or
   * the end. A lone `$` can become anything, so it counts: the guards read it as filled.
   */
  const startsExpansion = (after: string) =>
    expands.test(after) ||
    after === "" ||
    /\s/.test(after) ||
    after === escaper ||
    oneOf(double, after);
  /** Adds a character read outside single quotes: a `$` that expands, or a bash backtick, fills. */
  const addExpandable = (char: string, after: string) => {
    if ((char === "$" && startsExpansion(after)) || (bash && char === "`")) filled = true;
    add(char);
  };
  /** Each `(`'s close, worked out once for the segment and only when a substitution needs it. */
  let closes: Int32Array | null = null;
  const closeOf = (open: number) => {
    closes ??= parenCloses(segment);
    return closes[open] ?? -1;
  };
  let i = 0;
  while (i < segment.length) {
    const char = segment.charAt(i);
    const next = segment.charAt(i + 1);
    if (/\s/.test(char)) {
      end();
      i++;
    } else if (char === escaper && next === "\n") {
      i += 2; // the line goes on: the escape and the line break are gone
    } else if (char === escaper) {
      quoted = true;
      add(next === "" ? char : bash ? next : (POWERSHELL_ESCAPES[next] ?? next));
      i += 2;
    } else if (
      bash &&
      (char === "$" || (!inWord && (char === "<" || char === ">"))) &&
      next === "(" &&
      closeOf(i + 1) !== -1
    ) {
      // `$( … )`, and `<( … )` / `>( … )` at the start of a word: the shell fills in its answer (a
      // file name for the last two), so the whole substitution stays in its word, as the line
      // reader keeps it (`out=$(bun test 2>&1)` is one word, never `2>&1)`).
      const close = closeOf(i + 1);
      add(segment.slice(i, close));
      filled = true;
      i = close;
    } else if (bash && char === "&" && next === ">") {
      // `x&>file`: the `&` starts the redirection, so the word before it ends here.
      end();
      add(char);
      i++;
    } else if (char === "<" || char === ">") {
      // Bash's `&>file` and `&>>file` (both streams to a file) are one redirection: the bare `&`
      // before the `>` belongs to it, as a file number does.
      const bothStreams = bash && !quoted && char === ">" && word === "&";
      if (!bothStreams && (quoted || !/^\d+$/.test(word))) end();
      while (oneOf("<>", segment.charAt(i))) add(segment.charAt(i++));
      if (oneOf("&|", segment.charAt(i))) add(segment.charAt(i++));
    } else if (bash && char === "$" && next === "$") {
      // `$$`, the shell's process id: filled, and the `$` after it starts nothing.
      filled = true;
      add("$$");
      i += 2;
    } else if (bash && char === "$" && next === "'") {
      let close = i + 2;
      while (close < segment.length && segment.charAt(close) !== "'") {
        close += segment.charAt(close) === "\\" ? 2 : 1;
      }
      add(ansiText(segment.slice(i + 2, Math.min(close, segment.length))));
      quoted = true;
      i = close + 1;
    } else if (bash && char === "$" && next === '"') {
      i++; // `$"…"` is a double-quoted string, translated: the same words
    } else if (oneOf(single, char)) {
      quoted = true;
      inWord = true;
      i++;
      while (i < segment.length) {
        const inside = segment.charAt(i);
        if (oneOf(single, inside)) {
          if (bash || !oneOf(single, segment.charAt(i + 1))) break;
          add(inside);
          i += 2;
          continue;
        }
        add(inside);
        i++;
      }
      i++;
    } else if (oneOf(double, char)) {
      quoted = true;
      inWord = true;
      i++;
      while (i < segment.length) {
        const inside = segment.charAt(i);
        const after = segment.charAt(i + 1);
        if (oneOf(double, inside)) {
          if (bash || !oneOf(double, after)) break;
          add(inside);
          i += 2;
          continue;
        }
        if (bash && inside === "$" && after === "$") {
          filled = true;
          add("$$");
          i += 2;
          continue;
        }
        const substitution = bash && inside === "$" && after === "(" ? closeOf(i + 1) : -1;
        if (substitution !== -1) {
          // `"$(a "b c")"`: inside a substitution the quotes start again.
          add(segment.slice(i, substitution));
          filled = true;
          i = substitution;
          continue;
        }
        if (inside === escaper && after !== "") {
          if (!bash) add(POWERSHELL_ESCAPES[after] ?? after);
          else if ('$`"\\'.includes(after)) add(after);
          else if (after !== "\n") add(inside + after);
          i += 2;
          continue;
        }
        addExpandable(inside, after);
        i++;
      }
      i++;
    } else {
      addExpandable(char, next);
      i++;
    }
  }
  end();
  return words;
}

/**
 * For each bash `(` in `text`, the index after the `)` that closes it, else -1: one pass over the
 * text, so a line of a thousand unclosed `$(` costs no more than one. It steps over what bash
 * reads as text — `'…'`, `$'…'` (where `\'` is a quote), an escaped character, a backtick's
 * command — and reads `"…"` as bash does: only a `$(` inside it opens, and inside that the quotes
 * start again. A `case` pattern's `)` inside counts as a close, so such a substitution is cut
 * there, as the word reader always cut it.
 */
function parenCloses(text: string): Int32Array {
  const closes = new Int32Array(text.length).fill(-1);
  /** Each open `(` by its index, and -1 for an open `"`: the innermost last. */
  const open: number[] = [];
  /** The index of the quote that ends text read from `from` (`'` or a backtick), or -1. */
  const quoteEnd = (quote: string, from: number, escapes: boolean) => {
    for (let at = from; at < text.length; at++) {
      const char = text.charAt(at);
      if (escapes && char === "\\") at++;
      else if (char === quote) return at;
    }
    return -1;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    const next = text.charAt(i + 1);
    if (char === "\\" || (char === "$" && next === "$")) {
      i++; // an escaped character, or `$$` (the shell's process id): the second starts nothing
    } else if (char === "`") {
      i = quoteEnd("`", i + 1, true);
    } else if (open.at(-1) === -1) {
      if (char === '"') open.pop();
      else if (char === "$" && next === "(") open.push(++i);
    } else if (char === "'") {
      i = quoteEnd("'", i + 1, false);
    } else if (char === "$" && next === "'") {
      i = quoteEnd("'", i + 2, true);
    } else if (char === '"') {
      open.push(-1);
    } else if (char === "(") {
      open.push(i);
    } else if (char === ")") {
      const at = open.pop();
      if (at !== undefined && at >= 0) closes[at] = i + 1;
    }
    if (i === -1) break; // a quote that never closes: nothing after it is read
  }
  return closes;
}

/** Text that is data, not a command: skipped over when a segment is read for its program. */
const KEYWORDS = new Set(["!", "do", "done", "elif", "else", "fi", "if", "then", "until", "while"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

/**
 * True when every word is a `VAR=value` assignment: the step sets variables and runs nothing
 * (`FOO=1 BAR=2`). `FOO=1 tsc` is not one: a program follows.
 */
export function isAssignmentOnly(words: readonly string[]): boolean {
  return words.length > 0 && words.every((word) => ASSIGNMENT.test(word));
}

/** Commands that change the folder the rest of the line runs in (bash, cmd, PowerShell). */
export const CHANGE_DIR: ReadonlySet<string> = new Set([
  "cd",
  "chdir",
  "popd",
  "pushd",
  "set-location",
  "sl",
]);

/**
 * A redirection word: group 1 is the operator, group 2 its target when it is attached. A `<(`
 * or `>(` starts a process substitution, which is a word the program gets, not a redirection.
 */
const REDIRECTION = /^\d*(<<<|<<|<>|<|>>|>\||>|&>>|&>)(?!\()(.*)$/s;

/**
 * `REDIRECTION` for a word the reader knows the shell fills nothing into: its `(` was quoted or
 * escaped (`>\(x`, `>"(x"`), so the word is a redirection to a file whose name starts `(`.
 */
const ANY_REDIRECTION = /^\d*(<<<|<<|<>|<|>>|>\||>|&>>|&>)(.*)$/s;

/** A word's text, from `wordsOf` (a string) or `wordsWithFill`. */
const textOf = (word: string | ShellWord): string => (typeof word === "string" ? word : word.text);

/**
 * True for a bash process substitution, `<( … )` or `>( … )`: the shell puts a file of its own
 * there (`/dev/fd/63`). A string from `wordsOf` cannot say whether its `(` was quoted, so it
 * counts as one; a `ShellWord` says, by being filled.
 */
function isProcessSubstitution(word: string | ShellWord): boolean {
  return /^[<>]\(/.test(textOf(word)) && (typeof word === "string" || word.filled);
}

/**
 * Wrappers: each runs the command after it, so the command a line really runs is reached
 * through the wrapper's own options (`timeout 60 git push -f`, `env -i sudo -u me git push -f`).
 *
 * `sudo` and `doas` are here: the git guard reads through them. What runs as another user is
 * the merge reader's own rule — `after-merge.ts` refuses a merge under `sudo`/`doas`/`su`
 * (its reason: the view the guard read is not the view that merges).
 */
interface WrapperSpec {
  /** Long options that take the next word as their value. */
  long: string[];
  /** Short letters that take a value (the rest of their word, or the next word). */
  short: string;
  /** True for a word after the options that is not the command itself (`timeout 60 …`). */
  skip?: (word: string) => boolean;
  /** Options that mean nothing runs at all (`command -v git`). */
  inert?: string[];
  /** `env -S '…'`: the option whose value is split into the words of the command. */
  split?: { long: string; short: string };
  /**
   * `script -c '…'`, `flock <file> -c '…'`: the option whose value is the command line the
   * wrapper runs, after its own words (`from` to `to`, the value).
   */
  runs?: { long: string; short: string };
}

/** A duration, as `timeout` takes one (`60`, `30s`, `1.5m`). */
const DURATION = (word: string) => /^\d+(?:\.\d+)?[smhd]?$/.test(word);

/** A CPU mask, as `taskset` takes one (`0x3`, `1,2`). */
const CPU_MASK = (word: string) => /^(?:0x)?[0-9a-f]+(?:[,-][0-9a-f]+)*$/i.test(word);

/**
 * Wrappers that run the command after them. `setsid`, `flock`, `chrt`, `taskset`, `unbuffer`,
 * `nsenter` and `busybox` are here for the guards: `setsid git push -f` runs git, and a
 * reader that stopped at `setsid` let it through. `script -c` and `flock -c` name the command
 * in an option (`runs`), `busybox sh` names a shell whose script is read.
 */
const WRAPPERS: Record<string, WrapperSpec> = {
  builtin: { long: [], short: "" },
  busybox: { long: [], short: "" },
  chrt: {
    long: [
      "--sched-runtime",
      "--sched-period",
      "--sched-deadline",
      "--sched-priority",
      "--reset-on-fork",
    ],
    short: "PT",
    skip: (word) => /^-?\d+$/.test(word),
  },
  command: { inert: ["-v", "-V"], long: [], short: "" },
  // `cross-env A=1 B=2 prog args`: its VAR=x words are stepped over like any assignment
  // (`invocationOf` skips them after the wrapper), and it has no options of its own to read.
  "cross-env": { long: [], short: "" },
  doas: { long: [], short: "uC" },
  env: {
    long: ["--unset", "--chdir", "--split-string"],
    short: "uCS",
    split: { long: "--split-string", short: "S" },
  },
  exec: { long: [], short: "a" },
  flock: {
    long: ["--timeout", "--conflict-exit-code", "--command"],
    short: "wEc",
    // The lock file (or descriptor) comes before the command: `flock /tmp/l git push`.
    skip: () => true,
    runs: { long: "--command", short: "c" },
  },
  ionice: { long: ["--class", "--classdata", "--pid", "--pgid"], short: "cnpPu" },
  nice: { long: ["--adjustment"], short: "n" },
  nohup: { long: [], short: "" },
  nsenter: {
    long: ["--target", "--setuid", "--setgid", "--root", "--wd", "--wdns", "--env"],
    short: "tSG",
  },
  script: {
    long: ["--command", "--log-out", "--log-in", "--logging-format", "--timing", "--output-limit"],
    short: "cEOI",
    // The typescript file comes before the command (`script /tmp/log git push`, macOS).
    skip: () => true,
    runs: { long: "--command", short: "c" },
  },
  setsid: { long: [], short: "" },
  stdbuf: { long: ["--input", "--output", "--error"], short: "ioe" },
  sudo: {
    long: [
      "--user",
      "--group",
      "--host",
      "--prompt",
      "--close-from",
      "--chdir",
      "--chroot",
      "--command-timeout",
      "--other-user",
    ],
    short: "ughpCDRTU",
  },
  taskset: { long: ["--cpu-list"], short: "c", skip: CPU_MASK },
  time: { long: [], short: "" },
  timeout: { long: ["--signal", "--kill-after"], short: "sk", skip: DURATION },
  unbuffer: { long: [], short: "" },
  xargs: {
    long: [
      "--arg-file",
      "--delimiter",
      "--eof",
      "--max-args",
      "--max-chars",
      "--max-lines",
      "--max-procs",
      "--replace",
      "--process-slot-var",
    ],
    short: "adEILnPs",
  },
};

/** The shells whose script this module reads (`-c`, a here-doc, a here-string, a pipe). */
const SHELLS = new Set(["bash", "dash", "fish", "ksh", "mksh", "sh", "zsh"]);

/** True when `word` names a wrapper (`env`, `sudo`, `setsid`, …), which runs the command after it. */
export function isWrapper(word: string): boolean {
  return WRAPPERS[programName(word)] !== undefined;
}

/** A package whose binary is Claude Code's own `claude` (`@anthropic-ai/claude-code@2.1.3`). */
const CLAUDE_PACKAGE = /^@anthropic-ai\/claude-code(?:@[^/]*)?$/;

/** The programs that run a named package's binary: `npx @scope/pkg`, `bunx`, `pnpx`. */
const PACKAGE_RUNNERS: ReadonlySet<string> = new Set(["bunx", "npx", "pnpx"]);

/**
 * The command a package runner runs, when the package is Claude Code's: `npx
 * @anthropic-ai/claude-code --bg x` runs `claude`. Null for any other program or package.
 * `-p`/`--package` names the package and the command word after it (`npx -p
 * @anthropic-ai/claude-code claude --bg`); without a command word, the package's own binary
 * runs, which is `claude`.
 */
function packageCommand(
  program: string,
  args: readonly string[],
): { args: string[]; program: string } | null {
  let rest: readonly string[];
  if (PACKAGE_RUNNERS.has(program)) rest = args;
  else if (program === "pnpm" && args[0] === "dlx") rest = args.slice(1);
  else return null;
  for (let index = 0; index < rest.length; index++) {
    const word = rest[index] ?? "";
    if (word === "--") {
      const pkg = rest[index + 1];
      return pkg !== undefined && CLAUDE_PACKAGE.test(pkg)
        ? { args: rest.slice(index + 2), program: "claude" }
        : null;
    }
    const name = word.split("=")[0] ?? word;
    if (name === "-p" || name === "--package") {
      const inline = word.includes("=") ? word.slice(word.indexOf("=") + 1) : undefined;
      const pkg = inline ?? rest[index + 1];
      if (pkg === undefined || !CLAUDE_PACKAGE.test(pkg)) return null;
      const after = rest.slice(index + (inline === undefined ? 2 : 1));
      const command = after[0] === "claude" ? after.slice(1) : after;
      return { args: [...command], program: "claude" };
    }
    if (word.startsWith("-")) {
      // A runner option with a value this reader does not know: the next word may be the
      // package, so skip the option alone (`npx -y …`, `npx --registry x …`).
      index += /^--(?:registry|prefix|cache|userconfig)$/.test(name) ? 1 : 0;
      continue;
    }
    return CLAUDE_PACKAGE.test(word) ? { args: rest.slice(index + 1), program: "claude" } : null;
  }
  return null;
}

/**
 * The letters of a short option group (`-fdx` → `fdx`), up to the first one that takes a
 * value (the rest of the word, or the next word when nothing is attached). `value` is the
 * attached rest of the word, with one leading `=` dropped: gh's flag library (pflag) reads
 * `-X=POST` as `POST`, as it reads `-XPOST`. A caller for a program that keeps the `=` (git's
 * `-c=x` is `=x`) slices the word itself.
 */
export function shortFlags(
  arg: string,
  valued: string,
): { flags: string; value: string; wantsNext: boolean } {
  let flags = "";
  for (let i = 1; i < arg.length; i++) {
    const letter = arg.charAt(i);
    flags += letter;
    if (valued.includes(letter)) {
      const attached = arg.slice(i + 1);
      return {
        flags,
        value: attached.startsWith("=") ? attached.slice(1) : attached,
        wantsNext: i === arg.length - 1,
      };
    }
  }
  return { flags, value: "", wantsNext: false };
}

/** `-x` or `-xyz`, not `--long` and not a bare `-`. */
export function isShort(arg: string): boolean {
  return /^-[^-]/.test(arg);
}

/** What a command runs. */
export interface Invocation {
  /** The program: no folder, no `.exe`, lower case. */
  program: string;
  args: string[];
  /** The words before the program that start nothing of their own: `CI=1`, `sudo -u me`, `env`. */
  prefix: string[];
  /** The program is worked out when the line runs (`$GIT`, `$(which git)`, a backtick). */
  computed: boolean;
}

/** Where a wrapper's options end, and the words of an `env -S` string found among them. */
interface AfterWrapper {
  index: number;
  /**
   * `env -S 'a b'`: the words from `from` to `to` become `a`, `b`. `keep` is the option group
   * before the `S` (`-iS` keeps `-i`), or null.
   */
  split?: { from: number; to: number; value: string; keep: string | null };
  /**
   * `script -c 'git push'`, `flock <file> -c 'env …'`: the words from `from` to `to` become
   * the words of the command the wrapper runs.
   */
  runs?: { from: number; to: number; value: string };
}

/** The index after a wrapper's options: where the command it runs starts. */
function afterWrapper(
  words: readonly string[],
  from: number,
  spec: WrapperSpec,
): AfterWrapper | undefined {
  let index = from;
  /** A non-option word the wrapper takes before the command (`timeout 60 …`) was skipped. */
  let skipped = false;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (word === "--") return { index: index + 1 };
    if (!isShort(word) && !word.startsWith("--")) {
      // Only one such word belongs to the wrapper; the rest is its command, which may start
      // with a word no option reader knows (`flock <file> -c '…'` names the command in `-c`).
      if (!skipped && spec.skip?.(word) === true) {
        skipped = true;
        index++;
        continue;
      }
      break;
    }
    const name = word.split("=")[0] ?? word;
    if (spec.inert?.some((inert) => inert === name || inert === word) === true) return undefined;
    if (word.startsWith("--")) {
      const valued = spec.long.includes(name) && !word.includes("=");
      if (spec.split !== undefined && name === spec.split.long) {
        const value = valued ? (words[index + 1] ?? "") : word.slice(name.length + 1);
        const to = index + (valued ? 2 : 1);
        return { index, split: { from: index, to, value, keep: null } };
      }
      if (spec.runs !== undefined && name === spec.runs.long) {
        const value = valued ? (words[index + 1] ?? "") : word.slice(name.length + 1);
        return { index, runs: { from: index, to: index + (valued ? 2 : 1), value } };
      }
      index += valued ? 2 : 1;
      continue;
    }
    const { flags, wantsNext } = shortFlags(word, spec.short);
    if (spec.split !== undefined && flags.endsWith(spec.split.short)) {
      const value = wantsNext ? (words[index + 1] ?? "") : word.slice(flags.length + 1);
      const before = flags.slice(0, -1);
      const to = index + (wantsNext ? 2 : 1);
      return {
        index,
        split: { from: index, to, value, keep: before === "" ? null : `-${before}` },
      };
    }
    if (spec.runs !== undefined && flags.endsWith(spec.runs.short)) {
      const value = wantsNext ? (words[index + 1] ?? "") : word.slice(flags.length + 1);
      return { index, runs: { from: index, to: index + (wantsNext ? 2 : 1), value } };
    }
    index += wantsNext ? 2 : 1;
  }
  return { index };
}

/**
 * The program of a command (`git`, `npm`, … — no folder, no `.exe`), its arguments, and the
 * words before it. `VAR=x` assignments, shell keywords, redirections and wrappers (with
 * their options) are stepped over first, so the program is what actually runs:
 * `sudo -u me git push` is `git`, and so is `env -S 'git push'`. Undefined when nothing runs
 * (`command -v git`).
 *
 * `computed` says the program is worked out when the line runs (`$GIT`, `$(which git)`, a
 * backtick): the guards cannot name it, so each one asks about a line whose words are in its
 * domain instead of staying silent.
 */
export function invocationOf(words: readonly string[]): Invocation | undefined {
  let list = [...words];
  let splits = 0;
  let index = 0;
  while (index < list.length) {
    const word = list[index] ?? "";
    if (ASSIGNMENT.test(word) || KEYWORDS.has(word)) {
      index++;
      continue;
    }
    const redirection = REDIRECTION.exec(word);
    if (redirection !== null) {
      // `2>/dev/null git push`: the shell opens the file; the command comes after.
      index += (redirection[2] ?? "") === "" ? 2 : 1;
      continue;
    }
    const spec = WRAPPERS[programName(word)];
    if (spec === undefined) break;
    const after = afterWrapper(list, index + 1, spec);
    if (after === undefined) return undefined;
    if (after.split !== undefined && splits < MAX_NESTING) {
      // `env -S 'git push -f'` splits its string into the words of the command it runs, which
      // may start with more of env's own options: read on from there.
      const { from, keep, to, value } = after.split;
      const kept = keep === null ? [] : [keep];
      list = [...list.slice(0, from), ...kept, ...wordsOf(value), ...list.slice(to)];
      splits++;
      continue;
    }
    if (after.runs !== undefined && splits < MAX_NESTING) {
      // `script -c 'git push'`: the option's value holds the words of the command. Read on at
      // them: the wrapper's own words before them (its lock file, `-c`) stay the prefix.
      const { from, to, value } = after.runs;
      list = [...list.slice(0, from), ...wordsOf(value), ...list.slice(to)];
      index = from;
      splits++;
      continue;
    }
    index = after.split === undefined ? after.index : after.split.to;
  }
  const first = list[index];
  if (first === undefined) return undefined;
  const program = programName(first);
  const ran = packageCommand(program, list.slice(index + 1));
  const started = program === START_PROCESS ? startProcess(list.slice(index + 1)) : null;
  const command = started ?? ran;
  return {
    args: command?.args ?? list.slice(index + 1),
    computed: isComputedWord(first),
    prefix: [...list.slice(0, index), ...(started?.prefix ?? [])],
    program: command?.program ?? program,
  };
}

/**
 * True when a word is a program the shell works out when the line runs (`$GIT`,
 * `$(which git)`, a backtick). A path whose name is plain is not one: `$HOME/.local/bin/cc-smart-dev-kit`
 * names the command `cc-smart-dev-kit`, whatever folder it is in.
 */
export function isComputedWord(word: string): boolean {
  // `{}` is the file `find -exec` and `xargs -I{}` put in its place: whatever it names runs.
  if (word === "{}") return true;
  if (!word.startsWith("$") && !word.startsWith("`")) return false;
  return /[$`(){}[\]\s]/.test(programName(word));
}

/**
 * `Start-Process`'s parameters this reader knows: the name, and whether it takes a value
 * (`-FilePath`, `-ArgumentList`) or is a switch (`-UseNewEnvironment`). PowerShell accepts any
 * prefix that still names one parameter; a prefix naming none or several is skipped alone.
 */
const START_PROCESS_PARAMETERS: ReadonlyMap<string, boolean> = new Map([
  ["argumentlist", true],
  ["credential", true],
  ["erroraction", true],
  ["errorvariable", true],
  ["filepath", true],
  ["informationaction", true],
  ["informationvariable", true],
  ["loaduserprofile", false],
  ["nonewwindow", false],
  ["outbuffer", true],
  ["outvariable", true],
  ["passthru", false],
  ["pipelinevariable", true],
  ["redirectstandarderror", true],
  ["redirectstandardinput", true],
  ["redirectstandardoutput", true],
  ["usenewenvironment", false],
  ["verb", true],
  ["wait", false],
  ["warningaction", true],
  ["warningvariable", true],
  ["windowstyle", true],
  ["workingdirectory", true],
]);

/** The parameter a `-Name` / `-Name:value` word names, or null when it names none or several. */
function startProcessParameter(
  word: string,
): { name: string; takesValue: boolean; value: string | undefined } | null {
  const match = /^-([A-Za-z]\w*)(?::(.*))?$/.exec(word);
  const given = match?.[1]?.toLowerCase() ?? "";
  if (given === "") return null;
  const names = [...START_PROCESS_PARAMETERS.keys()].filter((name) => name.startsWith(given));
  const [name] = names;
  if (names.length !== 1 || name === undefined) return null;
  return { name, takesValue: START_PROCESS_PARAMETERS.get(name) === true, value: match?.[2] };
}

/**
 * The command `Start-Process` runs: its `-FilePath` (`-F`, or any prefix PowerShell accepts)
 * or the first positional word names the program, and `-ArgumentList` (`-A`) or the second
 * positional word its arguments (`Start-Process -FilePath git -ArgumentList 'push -f'`).
 * Null for anything else (no program named).
 *
 * `-UseNewEnvironment` starts the command with a fresh environment. The prefix then carries
 * `Start-Process` and the flag, where the escape guard reads them like `sudo` (`prefixDrop`).
 */
function startProcess(
  args: readonly string[],
): { args: string[]; prefix: string[]; program: string } | null {
  let file: string | null = null;
  let list: string[] | null = null;
  let fresh: string | null = null;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      positional.push(...args.slice(index + 1));
      break;
    }
    const parameter = startProcessParameter(arg);
    if (parameter === null) {
      if (!arg.startsWith("-")) positional.push(arg);
      continue;
    }
    const { name, takesValue } = parameter;
    let value = parameter.value;
    if (takesValue && value === undefined) {
      value = args[index + 1];
      index++;
    }
    if (name === "filepath" && value !== undefined) file = value;
    else if (name === "argumentlist" && value !== undefined) {
      // `-ArgumentList 'a b'` is one command line; `-ArgumentList a,b` is the array
      // PowerShell joins with spaces for the program.
      list = value
        .split(",")
        .flatMap((part) => wordsOf(part))
        .filter((one) => one !== "");
    } else if (name === "usenewenvironment") fresh = arg;
  }
  file ??= positional[0] ?? null;
  list ??= positional.length > 1 ? wordsOf(positional.slice(1).join(" ")) : [];
  if (file === null) return null;
  return {
    args: list,
    prefix: fresh === null ? [] : [START_PROCESS, fresh],
    program: programName(file),
  };
}

/** PowerShell's cmdlet that starts a program in its own process, as `programName` gives it. */
export const START_PROCESS = "start-process";

/**
 * A command's arguments without its redirections (`git push origin >log 2>&1` gives `push`,
 * `origin`): the program never sees them, so a check that reads its arguments must not.
 */
export function withoutRedirections(args: readonly string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const redirection = REDIRECTION.exec(args[index] ?? "");
    if (redirection === null) kept.push(args[index] ?? "");
    else if ((redirection[2] ?? "") === "") index++; // its target is the next word
  }
  return kept;
}

/** The redirection operators that open their target for writing (`<>` reads and writes). */
const WRITING_REDIRECTIONS = new Set([">", ">>", ">|", "&>", "&>>", "<>"]);

/**
 * The files a command's words redirect output into (`>log`, `2>>log`, `>| log`, `&>log`,
 * `> log`, `<>log`): the targets of `withoutRedirections`' dropped words that write. A
 * redirection to a file descriptor (`2>&1`, `>&2`, `>&-`) names no file, nor does one to a
 * process substitution (`> >(tee x)`). The words may hold the redirection before the program
 * (`>log cmd`), so pass every word of the step. Pass `wordsWithFill`'s words to tell a quoted
 * `(` (`>"(x"` writes the file `(x`) from a process substitution.
 */
export function redirectionTargets(words: readonly (string | ShellWord)[]): string[] {
  const targets: string[] = [];
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? "";
    const known = typeof word !== "string" && !word.filled;
    const redirection = (known ? ANY_REDIRECTION : REDIRECTION).exec(textOf(word));
    if (redirection === null) continue;
    let target = redirection[2] ?? "";
    if (target === "") {
      // The target is the next word.
      const next = words[++index] ?? "";
      if (isProcessSubstitution(next)) continue;
      target = textOf(next);
    }
    const operator = redirection[1] ?? "";
    if (operator === ">" && target.startsWith("&")) {
      // `>&2` and `>&-` name a descriptor; `>&log` sends both streams to the file.
      target = /^&(\d+|-)$/.test(target) ? "" : target.slice(1);
    }
    if (WRITING_REDIRECTIONS.has(operator) && target !== "") targets.push(target);
  }
  return targets;
}

/**
 * True when a shell takes its script from standard input: no `-c` (its script is the word
 * after that), no script file (`bash script.sh`). `-s` says it outright; a here-doc, a
 * here-string or a pipe then feeds it.
 */
export function shellTakesStdin(args: string[]): boolean {
  let stdin = false;
  let scriptFile = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    const redirection = REDIRECTION.exec(arg);
    if (redirection !== null) {
      if ((redirection[2] ?? "") === "") index++; // its target is the next word
      if ((redirection[1] ?? "").startsWith("<<")) stdin = true;
      continue;
    }
    if (arg === "-") {
      stdin = true;
      continue;
    }
    if (arg.startsWith("--")) {
      if (arg === "--init-file" || arg === "--rcfile") index++; // the next word is its value
      continue;
    }
    if (isShort(arg) || arg.startsWith("+")) {
      const letters = arg.replace(/^[-+]+/, "");
      if (letters.includes("c")) return false;
      if (letters.includes("s")) stdin = true;
      if (letters === "o") index++; // `-o option-name`
      continue;
    }
    // A script file (`bash script.sh`), or with `-s` a positional word: either way not stdin.
    scriptFile = true;
  }
  return stdin || !scriptFile;
}

/**
 * The command string of `bash -c …`: the first word that is no option, wherever `-c` stands
 * among the options (`bash -c -- 'x'`, `bash -c -e 'x'`, `bash -O extglob -c 'x'`, `-ec`).
 * Undefined without `-c`.
 */
function shellCommandString(args: readonly string[]): string | undefined {
  let commandMode = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") return commandMode ? args[index + 1] : undefined;
    const redirection = REDIRECTION.exec(arg);
    if (redirection !== null) {
      if ((redirection[2] ?? "") === "") index++;
      continue;
    }
    if (arg.startsWith("--")) {
      if (arg === "--init-file" || arg === "--rcfile") index++;
      continue;
    }
    if (/^[-+][A-Za-z]+$/.test(arg)) {
      const letters = arg.slice(1);
      if (arg.startsWith("-") && letters.includes("c")) commandMode = true;
      if (/[oO]$/.test(letters)) index++; // `-o pipefail`, `-O extglob`: the option's name
      continue;
    }
    return commandMode ? arg : undefined;
  }
  return undefined;
}

/** True when a segment is a shell that reads its script from standard input (`sh <<'EOF'`). */
function readsStdinShell(segment: string): boolean {
  const invocation = invocationOf(wordsOf(segment));
  return (
    invocation !== undefined && SHELLS.has(invocation.program) && shellTakesStdin(invocation.args)
  );
}

/**
 * What a command writes to its standard output, as far as it can be read: its arguments,
 * the program left out (`echo "git push -f"` → `git push -f`). Null when it prints nothing
 * of its own (`cat file`, a printf whose text is a variable).
 *
 * `printf` interprets the escapes in its format (`\n`, `\t`), so they are decoded here: a
 * script it prints is one script, not one word ending in `\n`.
 */
function writtenText(segment: string): string | null {
  const invocation = invocationOf(wordsOf(segment));
  if (invocation === undefined || invocation.args.length === 0) return null;
  const text = invocation.args.join(" ");
  return invocation.program === "printf" ? text.replace(/\\([nrt])/g, " ") : text;
}

/**
 * The programs whose own arguments name a command they run, and that do work of their own
 * beside it (`find -delete`, `su`'s user switch, `watch`'s endless repeat, `parallel`'s remote
 * hosts): `nestedCommand` reads the command each runs, and a caller that must not treat the
 * step as just that command (the job route) asks here. `xargs` is a wrapper, not one of these.
 */
export const RUNNER_PROGRAM_NAMES: readonly string[] = ["find", "parallel", "su", "watch"];

/** True when `program` is a runner (`RUNNER_PROGRAM_NAMES`). */
export function isRunnerProgram(program: string): boolean {
  return RUNNER_PROGRAM_NAMES.includes(program);
}

/** `find`'s actions that run a command, up to a `;` or a `{} +`. */
const FIND_EXEC: ReadonlySet<string> = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

/**
 * `find`'s tests and actions that take the next word as their value: `-name -exec` tests for a
 * file called `-exec`, which starts no command. (`-newerXY` takes one too.)
 */
const FIND_VALUED: ReadonlySet<string> = new Set([
  "-amin",
  "-anewer",
  "-atime",
  "-cmin",
  "-cnewer",
  "-context",
  "-ctime",
  "-fls",
  "-fprint",
  "-fprint0",
  "-fprintf",
  "-fstype",
  "-gid",
  "-group",
  "-iname",
  "-inum",
  "-ipath",
  "-iregex",
  "-iwholename",
  "-links",
  "-lname",
  "-maxdepth",
  "-mindepth",
  "-mmin",
  "-mtime",
  "-name",
  "-newer",
  "-path",
  "-perm",
  "-printf",
  "-regex",
  "-regextype",
  "-samefile",
  "-size",
  "-type",
  "-uid",
  "-used",
  "-user",
  "-wholename",
  "-xtype",
]);

/**
 * True when `word` ends a `find -exec` command, given the word before it: a `;` (escaped or
 * quoted, the shell hands find a bare `;`), or a `+` only right after `{}` — anywhere else a `+`
 * is an argument (`-exec flock + git push \;`). A `\;` that reaches us whole was quoted: an
 * argument too.
 */
function endsFindCommand(word: string, before: string): boolean {
  return word === ";" || (word === "+" && before === "{}");
}

/**
 * The commands `find` runs: the words of each `-exec`, `-execdir`, `-ok` and `-okdir` up to its
 * `;` or `{} +`, quoted so they read back the same, joined by `;` (several actions are several
 * commands). Undefined when `find` runs none.
 */
function findCommands(args: readonly string[]): string | undefined {
  const commands: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const word = args[index] ?? "";
    // A test that takes a value: its value is not an action, whatever it looks like.
    if (FIND_VALUED.has(word) || /^-newer[a-zA-Z]{2}$/.test(word)) {
      index++;
      continue;
    }
    if (!FIND_EXEC.has(word)) continue;
    const words: string[] = [];
    for (
      index++;
      index < args.length && !endsFindCommand(args[index] ?? "", args[index - 1] ?? "");
      index++
    ) {
      words.push(args[index] ?? "");
    }
    if (words.length > 0) commands.push(words.map(shellQuote).join(" "));
  }
  return commands.length === 0 ? undefined : commands.join(" ; ");
}

/**
 * The long option `word` names among `names`: the exact name, or the one name it is the start
 * of (getopt accepts a unique prefix, `--int` for `--interval`); null when it names none or
 * several. Any `=value` is left out of the comparison.
 */
function longOption(word: string, names: readonly string[]): string | null {
  const name = word.split("=")[0] ?? word;
  if (names.includes(name)) return name;
  const starts = names.filter((one) => one.startsWith(name));
  return starts.length === 1 ? (starts[0] ?? null) : null;
}

/** The long options of `watch` (procps-ng 4.0.4), and the ones that take a value. */
const WATCH_LONG = [
  "--beep",
  "--chgexit",
  "--color",
  "--cumulative",
  "--differences",
  "--equexit",
  "--errexit",
  "--exec",
  "--help",
  "--interval",
  "--no-color",
  "--no-title",
  "--no-wrap",
  "--precise",
  "--version",
] as const;
const WATCH_VALUED = new Set<string>(["--equexit", "--interval"]);

/**
 * The command `watch` runs. Its options end at the first word that is no option (`-n 5`,
 * `--interval=2`, `-d`), or at `--`; what follows is the command. Without `-x`/`--exec`, watch
 * hands the words to `sh -c` joined by spaces — so they are read the same way; with it, each
 * word is an argument of the program, quoted.
 */
function watchCommand(args: readonly string[]): string | undefined {
  let exec = false;
  let index = 0;
  for (; index < args.length; index++) {
    const word = args[index] ?? "";
    if (word === "--") {
      index++;
      break;
    }
    if (!word.startsWith("-") || word === "-") break;
    if (word.startsWith("--")) {
      const name = longOption(word, WATCH_LONG);
      if (name === "--exec") exec = true;
      // `--interval 5` takes the next word; `--interval=5` carries it.
      else if (name !== null && WATCH_VALUED.has(name) && !word.includes("=")) index++;
      continue;
    }
    // `-n <seconds>` and `-q <cycles>` take a value; `-d` takes one only attached (`-dq` is `-d`
    // with the value `q`: the next word is the command); the rest are switches.
    for (let at = 1; at < word.length; at++) {
      const letter = word.charAt(at);
      if (letter === "d") break;
      if (letter === "x") exec = true;
      if (letter === "n" || letter === "q") {
        if (at === word.length - 1) index++;
        break;
      }
    }
  }
  const words = args.slice(index);
  if (words.length === 0) return undefined;
  return exec ? words.map(shellQuote).join(" ") : words.join(" ");
}

/**
 * The command line `su` runs: the value of `-c` / `--command` (also in a group, `-lc`), wherever
 * the user's name stands (`su - me -c '…'`, `su -c '…' me`). Undefined for `su` alone, which
 * opens a shell and runs no command line of its own.
 */
function suCommand(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const word = args[index] ?? "";
    // After `--` su stops reading options, but the words still reach the shell it starts, and
    // a `-c <command>` among them runs (`su -- me -c '…'`): keep looking.
    if (word === "--") continue;
    if (word.startsWith("--")) {
      const name = longOption(word, SU_LONG);
      const carried = word.includes("=");
      if (name === "--command" || name === "--session-command") {
        return carried ? word.slice(word.indexOf("=") + 1) : args[index + 1];
      }
      if (name !== null && SU_VALUED.has(name) && !carried) index++;
      continue;
    }
    // The options of su that take a value: `-s <shell>`, `-g`, `-G`, `-w` and the command `-c`.
    if (isShort(word)) {
      const { flags, wantsNext } = shortFlags(word, "cgGsw");
      if (flags.endsWith("c")) return wantsNext ? args[index + 1] : word.slice(flags.length + 1);
      if (wantsNext) index++;
    }
  }
  return undefined;
}

/** The long options of `su` (util-linux), and the ones that take a value. */
const SU_LONG = [
  "--command",
  "--fast",
  "--group",
  "--help",
  "--login",
  "--preserve-environment",
  "--pty",
  "--session-command",
  "--shell",
  "--supp-group",
  "--version",
  "--whitelist-environment",
] as const;
const SU_VALUED = new Set<string>([
  "--command",
  "--group",
  "--session-command",
  "--shell",
  "--supp-group",
  "--whitelist-environment",
]);

/** GNU parallel's long options that take the next word (`--jobs 4`; `--jobs=4` carries it). */
const PARALLEL_VALUED = new Set([
  "--arg-file",
  "--arg-file-sep",
  "--arg-sep",
  "--block",
  "--colsep",
  "--delay",
  "--delimiter",
  "--env",
  "--eof",
  "--halt",
  "--header",
  "--jobs",
  "--joblog",
  "--load",
  "--max-args",
  "--max-lines",
  "--max-procs",
  "--memfree",
  "--nice",
  "--profile",
  "--recend",
  "--recstart",
  "--results",
  "--retries",
  "--rpl",
  "--sshlogin",
  "--sshloginfile",
  "--tagstring",
  "--timeout",
  "--workdir",
  // The rest of the man page's valued long options (GNU parallel 20240222), long and short forms.
  "--basefile",
  "--bf",
  "--block-size",
  "--bt",
  "--ctagstring",
  "--filter",
  "--group-by",
  "--id",
  "--jl",
  "--limit",
  "--max-chars",
  "--memsuspend",
  "--res",
  "--return",
  "--ssh",
  "--ssh-delay",
  "--term-seq",
  "--tf",
  "--tmpdir",
  "--tmpl",
  "--trc",
  "--wd",
]);

/** GNU parallel's long switches, which take no value. */
const PARALLEL_SWITCHES = new Set([
  "--bar",
  "--dry-run",
  "--eta",
  "--group",
  "--keep-order",
  "--line-buffer",
  "--pipe",
  "--progress",
  "--quote",
  "--shebang",
  "--tag",
  "--ungroup",
  "--verbose",
  "--will-cite",
  "--xargs",
]);

/** What starts the arguments of a parallel run: `:::` and friends (`::::` takes files). */
const PARALLEL_SOURCES = new Set([":::", "::::", ":::+", "::::+"]);

const PARALLEL_LONG: readonly string[] = [...PARALLEL_VALUED, ...PARALLEL_SWITCHES];

/**
 * Where the command of a `parallel` line can start. Its options come first; one this reader does
 * not know may or may not take the next word, so BOTH positions are possible — each index is
 * visited once, so no number of unknown options can hide the command, and the cost is linear.
 * A long option may be cut short to a unique prefix (Perl's Getopt::Long).
 */
function parallelStarts(args: readonly string[]): number[] {
  const starts = new Set<number>();
  const seen = new Set<number>();
  const queue = [0];
  for (let at = queue.pop(); at !== undefined; at = queue.pop()) {
    if (seen.has(at)) continue;
    seen.add(at);
    const word = args[at];
    if (word === undefined) {
      starts.add(at);
    } else if (word === "--") {
      starts.add(at + 1);
    } else if (!word.startsWith("-") || word === "-") {
      starts.add(at);
    } else if (word.startsWith("--")) {
      const carried = word.includes("=");
      const name = longOption(word, PARALLEL_LONG);
      if (name === null) queue.push(at + 1, at + 2);
      else queue.push(PARALLEL_VALUED.has(name) && !carried ? at + 2 : at + 1);
    } else {
      // A short group: `-j4` carries its value, `-j 4` takes the next word, `-k` and `-u` none.
      queue.push(shortFlags(word, "jnNPadSIELCsJ").wantsNext ? at + 2 : at + 1);
    }
  }
  return [...starts].sort((a, b) => a - b);
}

/**
 * The command lines GNU parallel runs, as they can be read, for each place the command may
 * start (`parallelStarts`): its words up to the first `:::`. The `:::` arguments run too —
 * parallel adds each to the command, quoted, or puts it where the command holds `{}` — so those
 * readings are returned as well; and when the command is a shell, each argument is also a script
 * of its own. With no command, the arguments are the commands ("If no command is given, the line
 * of input is executed"). `--arg-sep <s>` replaces `:::`.
 */
function parallelLines(args: readonly string[]): string[] {
  const sepAt = args.findIndex((word) => word === "--arg-sep" || word.startsWith("--arg-sep="));
  const sepWord = sepAt === -1 ? undefined : args[sepAt];
  const separator =
    sepWord === undefined
      ? null
      : sepWord.includes("=")
        ? sepWord.slice(sepWord.indexOf("=") + 1)
        : (args[sepAt + 1] ?? null);
  const isSource = (word: string) =>
    separator === null ? PARALLEL_SOURCES.has(word) : word === separator;
  const lines: string[] = [];
  for (const start of parallelStarts(args)) {
    let index = start;
    const command: string[] = [];
    for (; index < args.length && !isSource(args[index] ?? ""); index++) {
      command.push(args[index] ?? "");
    }
    // The arguments after a `:::` (those after `::::` are file names).
    const given: string[] = [];
    let reading = false;
    for (; index < args.length; index++) {
      const word = args[index] ?? "";
      if (isSource(word)) reading = !word.startsWith("::::");
      else if (reading) given.push(word);
    }
    if (command.length === 0) {
      if (given.length > 0) lines.push(given.join(" ; "));
      continue;
    }
    const line = command.join(" ");
    lines.push(line);
    if (given.length === 0) continue;
    const quoted = given.map(shellQuote).join(" ");
    lines.push(line.includes("{}") ? line.replaceAll("{}", quoted) : `${line} ${quoted}`);
    const program = programName(command[0] ?? "");
    if (SHELLS.has(program) || program === "eval") lines.push(...given);
  }
  return lines;
}

/** The command GNU parallel runs (`parallelLines`), the readings joined by `;`; undefined for none. */
function parallelCommand(args: readonly string[]): string | undefined {
  const lines = [...new Set(parallelLines(args))];
  return lines.length === 0 ? undefined : lines.join(" ; ");
}

/**
 * The words after `job run` when a program runs the kit's `job run`, else null. The kit's
 * command is recognised in one place (`kitArguments`, `kit-invocation.ts`): its name or a path
 * to the launcher, `bunx`, `sh <launcher>`, `bun …/dist/cli.js`, the bun shim.
 */
function jobRunArguments(program: string, args: readonly string[]): string[] | null {
  const kit = kitArguments(program, args);
  return kit !== null && kit[0] === "job" && kit[1] === "run" ? kit.slice(2) : null;
}

/**
 * `cc-smart-dev-kit job run …` under any spelling of the kit's command: the queue must not
 * nest.
 */
export function isJobRun(program: string, args: readonly string[]): boolean {
  return jobRunArguments(program, args) !== null;
}

/**
 * The command line a wrapper runs, when the line gives it one: `bash -c "…"` (a `c`
 * anywhere in a group of short options: `-ce`, `-ec`), a shell that reads its script from
 * standard input (`sh <<< "…"`, or the text piped from the command before it), `cmd /c …`,
 * `pwsh -Command "…"`, `iex "…"`, and the command `cc-smart-dev-kit job run -- …` queues.
 */
export function nestedCommand(
  program: string,
  args: string[],
  pipedFrom: string | null = null,
): string | undefined {
  // A program that runs its arguments (a shell, a runner, `cmd /c`, `pwsh -c`, `eval`) is read
  // as that program first, its whole line joined, so an operator a quoted word holds
  // (`eval cc-smart-dev-kit job run -- true '&&' git reset --hard`) is still a second command;
  // the kit inside it is then reached one level deeper. A branch that claims the program but
  // finds no command of its own (`sh <launcher> job run -- …`: a script, no `-c`) falls back to
  // the kit's `job run`, so no spelling the kit's recogniser knows goes unread.
  if (SHELLS.has(program)) {
    const script = shellCommandString(args);
    if (script !== undefined) return script;
    if (!shellTakesStdin(args)) return jobRunLine(program, args);
    const here = args.findIndex((arg) => arg === "<<<" || arg.startsWith("<<<"));
    if (here !== -1) {
      const word = args[here] ?? "";
      return word.length > 3 ? word.slice(3) : args.slice(here + 1).join(" ");
    }
    return pipedFrom === null ? undefined : (writtenText(pipedFrom) ?? undefined);
  }
  // The runners: programs that run a command they are given (`find -exec`, `watch`, `su -c`,
  // `parallel`). They stay the line's program, so the merge reader's rule for what a runner
  // does to a merge still holds; the command they run is read here, once, for every guard.
  if (program === "find") return findCommands(args) ?? jobRunLine(program, args);
  if (program === "watch") return watchCommand(args) ?? jobRunLine(program, args);
  if (program === "su") return suCommand(args) ?? jobRunLine(program, args);
  if (program === "parallel") return parallelCommand(args) ?? jobRunLine(program, args);
  // `cmd` and PowerShell run the file their first plain argument names, and every word after it
  // is that file's: a `/c` or `-c` after the kit's `job run` belongs to the job
  // (`pwsh cc-smart-dev-kit job run -- git -c x=y push --force`), so the job is read.
  if (program === "cmd") {
    const at = args.findIndex((arg) => /^\/[ck]$/i.test(arg));
    return at === -1 ? jobRunLine(program, args) : afterCommandFlag(program, args, at, shellQuote);
  }
  if (program === "powershell" || program === "pwsh") {
    // PowerShell takes any prefix of a parameter name: -c, -com, -Command.
    const at = args.findIndex((arg) => arg.length > 1 && "-command".startsWith(arg.toLowerCase()));
    // With no -Command the kit's job is read as PowerShell (`nestedDialect`), so it is quoted so.
    return at === -1
      ? jobRunLine(program, args, powershellQuoted)
      : afterCommandFlag(program, args, at, powershellQuoted);
  }
  if (program === "eval" || program === "iex" || program === "invoke-expression") {
    return args.join(" ");
  }
  return jobRunLine(program, args);
}

/**
 * What `cmd` or PowerShell runs when its `/c` or `-Command` is at `at`: the kit's job when the
 * words before `at` already start its `job run` (the flag is then the job's), else, and when
 * that job names no command (no `--`), the words after the flag.
 */
function afterCommandFlag(
  program: string,
  args: string[],
  at: number,
  quote: (word: string) => string,
): string {
  const job =
    jobRunArguments(program, args.slice(0, at)) === null
      ? undefined
      : jobRunLine(program, args, quote);
  return job ?? args.slice(at + 1).join(" ");
}

/**
 * The command the kit's `job run -- …` runs, when `program args` is one (`jobRunArguments`),
 * each word quoted by `quote`: the dialect `nestedDialect(program)` reads the line in.
 */
function jobRunLine(
  program: string,
  args: string[],
  quote: (word: string) => string = shellQuote,
): string | undefined {
  const queued = jobRunArguments(program, args);
  if (queued === null) return undefined;
  // The queue runs the words after `--` as they are: quoted again, they read back the same.
  const dashes = queued.indexOf("--");
  return dashes === -1 || dashes === queued.length - 1
    ? undefined
    : queued
        .slice(dashes + 1)
        .map(quote)
        .join(" ");
}

/** The dialect of the line `nestedCommand` finds: PowerShell's for `pwsh -c` and `iex`. */
export function nestedDialect(program: string): Dialect {
  return ["iex", "invoke-expression", "powershell", "pwsh"].includes(program)
    ? "powershell"
    : "bash";
}

/**
 * Every program the line runs, in order: each command of it, and the inner command of a
 * wrapper or a shell that reads its script from standard input (`bash -c "git push"` runs a
 * shell and `git`; `echo "git push -f" | sh` runs `echo` and `git`), three levels deep. In
 * `dialect`; not told the tool, Bash's list and then each program PowerShell's reading runs
 * more often than Bash's does, so a line both read alike gives one list.
 */
export function programsOf(command: string, dialect?: Dialect): string[] {
  if (dialect !== undefined) return programsIn(command, dialect);
  const found = programsIn(command, "bash");
  const left = [...found];
  for (const program of programsIn(command, "powershell")) {
    const at = left.indexOf(program);
    if (at === -1) found.push(program);
    else left.splice(at, 1);
  }
  return found;
}

/** `programsOf` in one dialect. */
function programsIn(command: string, dialect: Dialect): string[] {
  const found: string[] = [];
  const walk = (line: string, one: Dialect, depth: number): void => {
    for (const step of shellSteps(line, { blindWhenOpen: true, dialect: one, joinLines: true })) {
      const invocation = invocationOf(wordsOf(step.text, one));
      if (invocation === undefined) continue;
      found.push(invocation.program);
      const inner = nestedCommand(invocation.program, invocation.args, step.pipedFrom);
      if (inner !== undefined && depth < MAX_NESTING) {
        walk(inner, nestedDialect(invocation.program), depth + 1);
      }
    }
  };
  walk(command, dialect, 0);
  return found;
}

/** Does the shell fill in the word with this text? A reader of a command's arguments asks this. */
export type FillTest = (word: string) => boolean;

/**
 * The test for text no shell read: any `$` or backtick counts as filled. A reader falls back to
 * it for words that came from somewhere else (a gh alias's expansion) or that its caller did
 * not read with `wordsWithFill`, so it errs toward "cannot be read".
 */
export const anyFill: FillTest = (word) => /[$`]/.test(word);

/** The test for a command whose filled words are known (`RunInvocation.filled`). */
export function fillTest(filled: readonly string[]): FillTest {
  const set = new Set(filled);
  return (word) => set.has(word);
}

/**
 * The arguments of a command that are no word of its step: a wrapper cut them out of a string of
 * its own (`env -S '…'`, `script -c '…'`, `Start-Process -ArgumentList '…'`), and that string is
 * filled in by the wrapper, not by this line's quotes. They are read by their text: a `$` or a
 * backtick counts as filled.
 */
export function derivedFill(words: readonly string[], args: readonly string[]): string[] {
  const own = new Set(words);
  return args.filter((arg) => !own.has(arg) && anyFill(arg));
}

/** What the shell fills in for one step of a line (`fillOfStep`). */
export interface StepFill {
  /** The texts of the step's words the shell fills in; all of them when the line was filled in. */
  filled: string[];
  /**
   * The line this step hands to a command it runs (`bash -c "…"`, a pipe into `sh`, `eval`) was
   * filled in too: the quotes in it were written before the shell chose the text, so a reader
   * of that inner line treats every word of it as filled.
   */
  passes: boolean;
}

/**
 * Which words of a step the shell fills in. `inherited`: the line holding the step was
 * filled in already (`StepFill.passes` of the step that ran it). A step in the script of an
 * unquoted here-doc (`ShellStep.expanded`) is such a line. Conservative on purpose: one filled
 * word anywhere in a step that runs another line counts the whole inner line as filled.
 */
export function fillOfStep(
  step: ShellStep,
  words: readonly ShellWord[],
  dialect: Dialect,
  inherited: boolean,
): StepFill {
  const all = inherited || step.expanded;
  const own = words.some((word) => word.filled);
  const piped =
    step.pipedFrom !== null && wordsWithFill(step.pipedFrom, dialect).some((w) => w.filled);
  const filled = words.filter((word) => all || word.filled).map((word) => word.text);
  return { filled: [...new Set(filled)], passes: all || own || piped };
}

/** One command a line runs: its program, its arguments (redirections left in), and its words. */
export interface RunInvocation {
  args: string[];
  /** The program is worked out when the line runs (`$GH`, `$(which gh)`). */
  computed: boolean;
  program: string;
  /**
   * The texts of the words the shell fills in before the command runs (`ShellWord.filled`). A
   * line a filled word is part of (`bash -c "…$K…"`, `echo "…$K…" | sh`, an unquoted here-doc
   * script) hands the command it runs the whole of its words as filled: the quotes inside
   * that line were written before the shell chose the text.
   */
  filled: string[];
  /** Every word of the step, as the reader split it. */
  words: string[];
}

/**
 * Every command the line runs, in order, with its arguments: each command of it, and the inner
 * command of a wrapper or a shell (`bash -c "gh issue create"`), three levels deep — the walk
 * `programsOf` makes, handing back the whole invocation instead of the program. In `dialect`;
 * not told the tool, both readings, each command once.
 */
export function invocationsOf(command: string, dialect?: Dialect): RunInvocation[] {
  const walk = (
    line: string,
    one: Dialect,
    depth: number,
    into: RunInvocation[],
    inherited: boolean,
  ): void => {
    for (const step of shellSteps(line, { blindWhenOpen: true, dialect: one, joinLines: true })) {
      const read = wordsWithFill(step.text, one);
      const words = read.map((word) => word.text);
      const fill = fillOfStep(step, read, one, inherited);
      const invocation = invocationOf(words);
      if (invocation === undefined) continue;
      into.push({
        args: invocation.args,
        computed: invocation.computed,
        filled: [...fill.filled, ...derivedFill(words, invocation.args)],
        program: invocation.program,
        words,
      });
      const inner = nestedCommand(invocation.program, invocation.args, step.pipedFrom);
      if (inner !== undefined && depth < MAX_NESTING) {
        walk(inner, nestedDialect(invocation.program), depth + 1, into, fill.passes);
      }
    }
  };
  const found: RunInvocation[] = [];
  for (const one of dialect === undefined ? (["bash", "powershell"] as const) : [dialect]) {
    walk(command, one, 0, found, false);
  }
  const seen = new Set<string>();
  return found.filter((one) => {
    const key = JSON.stringify(one);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
