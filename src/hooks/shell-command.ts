/**
 * Reading a shell command line (Bash and PowerShell) as the commands it runs.
 *
 * ONE lexer for every check that asks "does this line RUN that command?": the git guard
 * (`git-guard.ts`: a force-push, a push to a protected branch, `reset --hard`, …) and the
 * merge check (`after-merge.ts`). Text that only MENTIONS a command — inside quotes, a
 * here-doc body, a comment — must never read as that command, or a guard asks about a
 * commit message and a hook reports a merge after a `grep`.
 *
 * What is text, not a command:
 *   - `'…'`, `"…"`, `$'…'`, and a PowerShell here-string `@"…"@`;
 *   - a here-doc body (`<<EOF`, `<<-'EOF'` … up to its closing line);
 *   - a `#` comment that starts a word.
 * What is a command even inside quotes: `$( … )` in a double-quoted string (depth-tracked,
 * with its own quotes and here-docs — the `git commit -m "$(cat <<'EOF' … EOF)"` idiom).
 * A shell keyword or a wrapper is stepped over to reach the command it stands before
 * (`… ; do git branch -D x; done`, `timeout 60 git push -f`, `env -i sudo -u me git push -f`,
 * `xargs git push -f`). A shell that reads its script from standard input (`sh`, `bash -s`,
 * `… | sh`) has its here-doc body, its here-string, or the text piped from the command
 * before it read as command lines.
 * Not read: a backtick substitution, `-EncodedCommand`, `ssh`, a script file.
 *
 * A backslash is an escape only before a quote, a backslash or a backtick (and `$` inside
 * double quotes): in a Windows path, `D:\;` still ends the command. In PowerShell the
 * backtick escapes the same way.
 */

/** How many `bash -c "bash -c …"` levels a caller reads. */
export const MAX_NESTING = 3;

/** Where a shell command ends: `;` `&&` `||` `|` a new line — and the braces of `if (…) { … }`. */
const SEPARATORS = new Set(["\n", "\r", "&", "(", ")", ";", "{", "|", "}"]);

/** A `\` or a backtick at the end of a line: the line goes on in the next. */
const CONTINUATION = /[\\`][ \t]*\r?\n/y;

/** `<<WORD`, `<<-'WORD'`, `<<"WORD"`: group 1 is `-` (tabs stripped), the rest the word. */
const HERE_DOC = /<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([^\s"'<>;&|()]+))/y;

/** A PowerShell here-string: `@"`, a line break, any lines, then `"@` at the start of a line. */
const HERE_STRING = /@(["'])\r?\n[\s\S]*?\r?\n\1@/y;

interface Lexed {
  /** A quote or a here-doc that never closes: what follows is read as text, or not at all. */
  open: boolean;
  segments: string[];
  /** For each segment: the text of the command it is piped from (`a | b`), else null. */
  piped: (string | null)[];
}

/**
 * One pass over the line. `blind` ignores quotes, escapes, comments and `$( )` — only
 * here-docs and here-strings that close are cut, and every separator splits — so a command
 * hidden after a quote that never closes still shows up. `join` glues a line that ends in
 * `\` or a backtick to the next.
 */
function lex(text: string, { blind, join }: { blind: boolean; join: boolean }): Lexed {
  const segments: string[] = [];
  const piped: (string | null)[] = [];
  const owed: { stripTabs: boolean; script: boolean; word: string }[] = [];
  let open = false;
  let at = 0;
  /** Whether the segment now being read is piped from the one before it (`a | b`). */
  let afterPipe = false;

  const push = (piece: string, from: string | null): void => {
    segments.push(piece);
    piped.push(from);
  };

  /** Just past a line break: step over the body of each here-doc the line opened. */
  function skipBodies(): void {
    for (const { stripTabs, script, word } of owed.splice(0)) {
      let line = at;
      let closedAt = -1;
      let bodyEnd = -1;
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
      if (closedAt !== -1) {
        // A shell reads the body as its script (`sh <<'EOF' … EOF`): read it as one.
        if (script) {
          const body = lex(text.slice(at, bodyEnd), { blind, join });
          for (let i = 0; i < body.segments.length; i++) {
            push(body.segments[i] ?? "", body.piped[i] ?? null);
          }
        }
        at = closedAt;
      } else if (!blind) {
        // The body runs to the end of the line, and nothing in it is a command.
        open = true;
        at = text.length;
      }
    }
  }

  /**
   * The index after the `))` that closes the `$((` whose second `(` is at `from`
   * (`$((1<<2))`), or -1 when it is no arithmetic: it must start `((`, end `))` and hold
   * no `;` — otherwise it is `$( (subshell) … )`, whose commands are read.
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

  /** `"…"` at `at`, with the commands of its `$( … )` pushed as segments of their own. */
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
          raw += `$(${read(true).raw}`;
        } else {
          raw += text.slice(at, end);
          at = end;
        }
      } else {
        raw += char;
        at++;
      }
    }
    // Never closed: nothing inside it runs.
    open = true;
    segments.length = mark;
    piped.length = mark;
    return raw;
  }

  /**
   * Reads commands to the end of the line, or (`nested`) to the `)` that closes a `$(`.
   * `raw` is the text read, bodies cut — what the enclosing quoted word holds.
   */
  function read(nested: boolean): { raw: string } {
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
          owed.push({ stripTabs: opener[1] === "-", script: readsStdinShell(current), word });
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
        const quoted = HERE_STRING.exec(text);
        if (quoted !== null) {
          take(`${next}${next}`);
          at = HERE_STRING.lastIndex;
          continue;
        }
      }
      if (SEPARATORS.has(char)) {
        const wasPiped = afterPipe;
        push(current, wasPiped ? (segments[segments.length - 1] ?? null) : null);
        afterPipe = char === "|";
        if (nested && char === ")" && depth === 0) {
          at++;
          return { raw: `${raw})` };
        }
        if (nested && char === "(") depth++;
        if (nested && char === ")") depth--;
        current = "";
        raw += char;
        at++;
        if (char === "\n") skipBodies();
        continue;
      }
      take(char);
      at++;
    }
    // End of text: for a `$(` that never closed, `readDouble` marks the quote open.
    push(current, afterPipe ? (segments[segments.length - 1] ?? null) : null);
    return { raw };
  }

  read(false);
  return { open, piped, segments };
}

/**
 * The commands of a shell line, one string each, in order: every `$( … )` inside a double
 * quote adds its commands, and the quoted word that holds it stays in its command whole.
 * `blindWhenOpen`: when a quote never closes, split on every separator instead (more
 * pieces, so nothing hides in it) — a guard wants that; a check for something that
 * RAN does not, and reads the open quote as text. `joinLines`: a line ending in `\` or a
 * backtick goes on in the next.
 */
export function shellSegments(
  command: string,
  { blindWhenOpen = false, joinLines = false } = {},
): string[] {
  return shellSteps(command, { blindWhenOpen, joinLines }).map((step) => step.text);
}

/** One command of a shell line: its text, and the command whose output feeds it. */
export interface ShellStep {
  text: string;
  /** The text of the command this one is piped from (`a | b`), else null. */
  pipedFrom: string | null;
}

/** `shellSegments`, keeping which command each one is piped from. */
export function shellSteps(
  command: string,
  { blindWhenOpen = false, joinLines = false } = {},
): ShellStep[] {
  const read = lex(command, { blind: false, join: joinLines });
  const chosen = read.open && blindWhenOpen ? lex(command, { blind: true, join: joinLines }) : read;
  return chosen.segments.map((text, index) => ({ text, pipedFrom: chosen.piped[index] ?? null }));
}

/** Text that is data, not a command: skipped over when a segment is read for its program. */
const KEYWORDS = new Set(["!", "do", "done", "elif", "else", "fi", "if", "then", "until", "while"]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;

/**
 * Wrappers: each runs the command after it, so the command a line really runs is reached
 * through the wrapper's own options (`timeout 60 git push -f`, `env -i sudo -u me git push -f`).
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
}

/** A duration, as `timeout` takes one (`60`, `30s`, `1.5m`). */
const DURATION = (word: string) => /^\d+(?:\.\d+)?[smhd]?$/.test(word);

const WRAPPERS: Record<string, WrapperSpec> = {
  builtin: { long: [], short: "" },
  command: { inert: ["-v", "-V"], long: [], short: "" },
  env: { long: ["--unset", "--chdir", "--split-string"], short: "uCS" },
  exec: { long: [], short: "a" },
  ionice: { long: ["--class", "--classdata", "--pid", "--pgid"], short: "cnpPu" },
  nice: { long: ["--adjustment"], short: "n" },
  nohup: { long: [], short: "" },
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
  time: { long: [], short: "" },
  timeout: { long: ["--signal", "--kill-after"], short: "sk", skip: DURATION },
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
const SHELLS = new Set(["bash", "dash", "sh", "zsh"]);

/** A redirection word: group 1 is the operator, group 2 its target when it is attached. */
const REDIRECTION = /^\d*(<<<|<<|<>|<|>>|>\||>|>&|&>)(.*)$/;

/** `git.exe` → `git`, `C:\Program Files\Git\cmd\git` → `git`. */
function programName(word: string): string {
  return (word.split(/[\\/]/).pop() ?? word).toLowerCase().replace(/\.(exe|cmd|ps1|bat)$/, "");
}

/**
 * The letters of a short option group (`-fdx` → `fdx`), up to the first one that takes a
 * value (the rest of the word, or the next word when nothing is attached).
 */
export function shortFlags(arg: string, valued: string): { flags: string; wantsNext: boolean } {
  let flags = "";
  for (let i = 1; i < arg.length; i++) {
    const letter = arg.charAt(i);
    flags += letter;
    if (valued.includes(letter)) return { flags, wantsNext: i === arg.length - 1 };
  }
  return { flags, wantsNext: false };
}

/** `-x` or `-xyz`, not `--long` and not a bare `-`. */
export function isShort(arg: string): boolean {
  return /^-[^-]/.test(arg);
}

/** The index after a wrapper's options: where the command it runs starts. */
function afterWrapper(words: string[], from: number, spec: WrapperSpec): number | undefined {
  let index = from;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (word === "--") return index + 1;
    if (!isShort(word) && !word.startsWith("--")) break;
    const name = word.split("=")[0] ?? word;
    if (spec.inert?.some((inert) => inert === name || inert === word) === true) return undefined;
    if (word.startsWith("--")) {
      index += spec.long.includes(name) && !word.includes("=") ? 2 : 1;
      continue;
    }
    index += shortFlags(word, spec.short).wantsNext ? 2 : 1;
  }
  return spec.skip?.(words[index] ?? "") === true ? index + 1 : index;
}

/**
 * The words of one command, the quotes AROUND a piece removed: `-m "a b"` → `-m`, `a b`;
 * `-c 'echo "x; y"'` → `-c`, `echo "x; y"` — the inner quotes stay, so a `bash -c` word
 * can be read again as a command line. In double quotes `\"` and `\\` lose their backslash.
 */
export function wordsOf(segment: string): string[] {
  const words = segment.match(/(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s"'])+/g) ?? [];
  return words.map((word) =>
    word.replace(/"((?:\\.|[^"\\])*)"|'([^']*)'/g, (_, double: string | undefined, single) =>
      double === undefined ? String(single) : double.replace(/\\(["\\$`])/g, "$1"),
    ),
  );
}

/**
 * The program of a command (`git`, `npm`, … — no folder, no `.exe`) and its arguments.
 * `VAR=x` assignments, shell keywords and wrappers (with their options) are stepped over
 * first, so the program is what actually runs: `sudo -u me git push` is `git`. Undefined
 * when nothing runs (`command -v git`).
 */
export function invocationOf(words: string[]): undefined | { args: string[]; program: string } {
  let index = 0;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (ASSIGNMENT.test(word) || KEYWORDS.has(word)) {
      index++;
      continue;
    }
    const spec = WRAPPERS[programName(word)];
    if (spec === undefined) break;
    const after = afterWrapper(words, index + 1, spec);
    if (after === undefined) return undefined;
    index = after;
  }
  const first = words[index];
  if (first === undefined) return undefined;
  return { args: words.slice(index + 1), program: programName(first) };
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
 * The command line a wrapper runs, when the line gives it one: `bash -c "…"` (a `c`
 * anywhere in a group of short options: `-ce`, `-ec`), a shell that reads its script from
 * standard input (`sh <<< "…"`, or the text piped from the command before it), `cmd /c …`,
 * `pwsh -Command "…"`, `iex "…"`.
 */
export function nestedCommand(
  program: string,
  args: string[],
  pipedFrom: string | null = null,
): string | undefined {
  if (SHELLS.has(program)) {
    const at = args.findIndex((arg) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg));
    if (at !== -1) return args[at + 1];
    if (!shellTakesStdin(args)) return undefined;
    const here = args.findIndex((arg) => arg === "<<<" || arg.startsWith("<<<"));
    if (here !== -1) {
      const word = args[here] ?? "";
      return word.length > 3 ? word.slice(3) : args.slice(here + 1).join(" ");
    }
    return pipedFrom === null ? undefined : (writtenText(pipedFrom) ?? undefined);
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

/**
 * Every program the line runs, in order: each command of it, and the inner command of a
 * wrapper or a shell that reads its script from standard input (`bash -c "git push"` runs a
 * shell and `git`; `echo "git push -f" | sh` runs `echo` and `git`), three levels deep.
 */
export function programsOf(command: string): string[] {
  const found: string[] = [];
  const walk = (line: string, depth: number): void => {
    for (const step of shellSteps(line, { blindWhenOpen: true, joinLines: true })) {
      const invocation = invocationOf(wordsOf(step.text));
      if (invocation === undefined) continue;
      found.push(invocation.program);
      const inner = nestedCommand(invocation.program, invocation.args, step.pipedFrom);
      if (inner !== undefined && depth < MAX_NESTING) walk(inner, depth + 1);
    }
  };
  walk(command, 0);
  return found;
}
