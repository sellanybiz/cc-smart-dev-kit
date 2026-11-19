/**
 * The shell reader (`src/shell/command.ts`), the one every check reads a line with: the git
 * guard, the merge reader, job-route, the classifier and `job run`. It cuts a line into the
 * commands it RUNS, in the dialect of the tool that runs it, and never mistakes text
 * (quotes, quoted here-doc bodies, comments) for a command. Every expected list is written
 * by hand. The guards' and the classifier's own tests cover what they decide from it.
 */
import { describe, expect, test } from "bun:test";
import {
  dialectOfTool,
  invocationOf,
  invocationsOf,
  nestedCommand,
  nestedDialect,
  programsOf,
  readingsOf,
  redirectionTargets,
  shellSegments,
  shellSteps,
  shortFlags,
  withoutRedirections,
  wordsOf,
  wordsWithFill,
} from "./command";

const ps = { dialect: "powershell" } as const;

describe("shellSegments — where a command ends", () => {
  test("splits at ; && || | & new lines, and parentheses", () => {
    expect(shellSegments("git add . && git commit -m x")).toEqual([
      "git add . ",
      "",
      " git commit -m x",
    ]);
    expect(shellSegments("a; b | c\nd")).toEqual(["a", " b ", " c", "d"]);
  });

  test("splits at a brace: in PowerShell always, in bash only at a brace that is a word", () => {
    expect(shellSegments("if ($?) { x }", ps)).toEqual(["if ", "$?", " ", " x ", ""]);
    expect(shellSegments("{ x; }")).toEqual(["", " x", " ", ""]);
    expect(shellSegments("f(){ x; }")).toEqual(["f", "", "", " x", " ", ""]);
    // HK-4: inside a word a brace is a character: `HEAD@{0}`, `{a,b}`, `${x}`.
    expect(shellSegments("git push origin HEAD@{0}:main")).toEqual([
      "git push origin HEAD@{0}:main",
    ]);
    expect(shellSegments(`echo {a,b} \${x}; ls`)).toEqual([`echo {a,b} \${x}`, " ls"]);
    expect(shellSegments("git push origin HEAD@{0}:main", ps)).toEqual([
      "git push origin HEAD@",
      "0",
      ":main",
    ]);
  });

  test("keeps a separator inside quotes", () => {
    expect(shellSegments('git commit -m "a; b|c"')).toEqual(['git commit -m "a; b|c"']);
    expect(shellSegments("echo 'a && b'; ls")).toEqual(["echo 'a && b'", " ls"]);
    expect(shellSegments('echo "say \\"hi\\"; ls"')).toEqual(['echo "say \\"hi\\"; ls"']);
  });

  test("bash: a backslash escapes the character after it", () => {
    expect(shellSegments('echo \\"; ls')).toEqual(['echo \\"', " ls"]);
    // `\;` is no separator: bash runs `cd 'D:;' ls`.
    expect(shellSegments("cd D:\\; ls")).toEqual(["cd D:\\; ls"]);
    // HK escaped space: `\ #` is a word that holds `#`, not a comment.
    expect(shellSegments("echo \\ #; ls")).toEqual(["echo \\ #", " ls"]);
  });

  test("PowerShell: the backtick escapes, and a backslash is a plain character", () => {
    expect(shellSegments('echo `"; ls', ps)).toEqual(['echo `"', " ls"]);
    expect(shellSegments("cd D:\\; ls", ps)).toEqual(["cd D:\\", " ls"]);
    // HK-3: `"C:\repo\"` ends at its last quote.
    expect(shellSegments('cd "C:\\repo\\"; ls', ps)).toEqual(['cd "C:\\repo\\"', " ls"]);
    expect(shellSegments('cd "C:\\repo\\"; ls')).toEqual(['cd "C:\\repo\\"; ls']);
  });

  test("reads $'…' with a backslash-escaped quote", () => {
    expect(shellSegments("echo $'a\\'; b'; ls")).toEqual(["echo $'a\\'; b'", " ls"]);
  });

  test("drops a # comment that starts a word, not one inside a word", () => {
    expect(shellSegments("echo hi # ; ls\npwd")).toEqual(["echo hi ", "pwd"]);
    expect(shellSegments("echo a#b; ls")).toEqual(["echo a#b", " ls"]);
    expect(shellSegments("echo $#; ls")).toEqual(["echo $#", " ls"]);
    // `$(x)#y` is one word: the `#` after its `)` starts no comment.
    expect(shellSegments("echo $(x)#; ls")).toEqual(["x", "echo $(x)#", " ls"]);
  });

  test("PowerShell: a block comment, a typographic quote, and `--%`", () => {
    expect(shellSegments("<# a; b #> ls; pwd", ps)).toEqual(["  ls", " pwd"]);
    expect(shellSegments("echo \u2018a; b\u2019; ls", ps)).toEqual([
      "echo \u2018a; b\u2019",
      " ls",
    ]);
    expect(shellSegments('echo \u201Ca; b"; ls', ps)).toEqual(['echo \u201Ca; b"', " ls"]);
    expect(shellSegments("echo 'it''s; x'; ls", ps)).toEqual(["echo 'it''s; x'", " ls"]);
    expect(shellSegments("icacls --% /grant a;b | ls", ps)).toEqual([
      "icacls --% /grant a;b ",
      " ls",
    ]);
  });

  test("PowerShell runs nothing of a line with a bare `<`: it cannot parse it", () => {
    expect(shellSegments("cat <<'EOF'\nls\nEOF", ps)).toEqual([]);
    expect(shellSegments("echo '<'; ls", ps)).toEqual(["echo '<'", " ls"]);
  });
});

describe("shellSegments — here-docs and here-strings", () => {
  test("drops a quoted body up to its closing line", () => {
    expect(shellSegments("cat <<'EOF'\nnpm i\nEOF")).toEqual(["cat <<'EOF'", ""]);
    expect(shellSegments('cat <<"EOF" && ls\nnpm i\nEOF')).toEqual(['cat <<"EOF" ', "", " ls", ""]);
    expect(shellSegments("cat <<\\EOF\n$(npm i)\nEOF\nls")).toEqual(["cat <<\\EOF", "ls"]);
    expect(shellSegments('cat <<E"O"F\n$(npm i)\nEOF\nls')).toEqual(['cat <<E"O"F', "ls"]);
  });

  test("HK-2: reads the substitutions of an unquoted body, and nothing else of it", () => {
    expect(shellSegments("cat <<EOF\nnpm install\nEOF\nls")).toEqual(["cat <<EOF", "ls"]);
    expect(shellSegments("cat <<EOF\na $(npm i) `pwd` $((1+$(id)))\nEOF\nls")).toEqual([
      "cat <<EOF",
      "npm i",
      "pwd",
      "id",
      "ls",
    ]);
  });

  test("strips leading tabs of the closing line only after `<<-`", () => {
    expect(shellSegments("cat <<-EOF\n\tx\n\tEOF\nls")).toEqual(["cat <<-EOF", "ls"]);
    // Without `-` the indented line is body, so the here-doc runs on to the real one.
    expect(shellSegments("cat <<EOF\n\tEOF\nls\nEOF\npwd")).toEqual(["cat <<EOF", "pwd"]);
  });

  test("ends a body at a closing line that has a carriage return", () => {
    expect(shellSegments("cat <<EOF\r\nx\r\nEOF\r\nls")).toEqual(["cat <<EOF", "", "ls"]);
  });

  test("reads a delimiter with a dash, and the two here-docs of one line in order", () => {
    expect(shellSegments("cat <<END-OF-TEXT\nEND\nEND-OF-TEXT\nls")).toEqual([
      "cat <<END-OF-TEXT",
      "ls",
    ]);
    expect(shellSegments("cat <<A <<B\na\nA\nb\nB\nls")).toEqual(["cat <<A <<B", "ls"]);
  });

  test("is no here-doc: `<<<` or `$((1<<2))`", () => {
    expect(shellSegments("cat <<<EOF\nls")).toEqual(["cat <<<EOF", "ls"]);
    expect(shellSegments("echo $((1<<2))\nls")).toEqual(["echo $((1<<2))", "ls"]);
  });

  test('PowerShell: cuts a here-string to an empty string, and reads `@"…"@`\'s substitutions', () => {
    expect(shellSegments('x @"\nnpm install\n"@ | y', ps)).toEqual(['x "" ', " y"]);
    expect(shellSegments("x @'\nnpm install\n'@", ps)).toEqual(["x ''"]);
    expect(shellSegments('x @"\n$(npm i)\n"@', ps)).toEqual(["npm i", 'x ""']);
    expect(shellSegments("x @'\n$(npm i)\n'@", ps)).toEqual(["x ''"]);
  });

  test('bash: `@"…"@` is an `@` and a double-quoted string, whose substitutions run', () => {
    expect(shellSegments('x @"\n$(npm i)\n"@')).toEqual(["npm i", 'x @"\n$(npm i)\n"@']);
  });

  test("an unclosed here-doc runs to the end: its substitutions are read; blind, its lines", () => {
    expect(shellSegments("cat <<EOF\nls")).toEqual(["cat <<EOF", ""]);
    expect(shellSegments("cat <<EOF\n$(ls)")).toEqual(["cat <<EOF", "ls", ""]);
    expect(shellSegments("cat <<EOF\nls", { blindWhenOpen: true })).toEqual(["cat <<EOF", "ls"]);
  });
});

describe("shellSegments — substitutions", () => {
  test("adds the commands of `$( … )` in double quotes, ahead of the command that holds it", () => {
    expect(shellSegments('echo "a $(gh pr merge 1; ls) b"; pwd')).toEqual([
      "gh pr merge 1",
      " ls",
      'echo "a $(gh pr merge 1; ls) b"',
      " pwd",
    ]);
  });

  test("reads its own quotes and here-docs: the commit idiom", () => {
    const line = 'git commit -m "$(cat <<\'EOF\'\nthe "quoted\ngh pr merge 1\nEOF\n)" && ls';
    expect(shellSegments(line)).toEqual([
      "cat <<'EOF'",
      "",
      "git commit -m \"$(cat <<'EOF'\n)\" ",
      "",
      " ls",
    ]);
  });

  test("reads a subshell inside it, and the substitutions inside arithmetic", () => {
    expect(shellSegments('echo "$((ls); pwd)"')).toEqual([
      "",
      "ls",
      "",
      " pwd",
      'echo "$((ls); pwd)"',
    ]);
    expect(shellSegments('echo "$((1+2))"; ls')).toEqual(['echo "$((1+2))"', " ls"]);
    expect(shellSegments("echo $(( $(id) + 1 )); ls")).toEqual([
      "id",
      "echo $(( $(id) + 1 ))",
      " ls",
    ]);
  });

  test("bash: a backtick substitution's commands are read; in PowerShell a backtick escapes", () => {
    expect(shellSegments("echo `ls; pwd`; id")).toEqual(["ls", " pwd", "echo `ls; pwd`", " id"]);
    expect(shellSegments('echo "`ls`"')).toEqual(["ls", 'echo "`ls`"']);
    expect(shellSegments("echo `ls`", ps)).toEqual(["echo `ls`"]);
  });

  test("PowerShell: `$( … )` in a double-quoted string", () => {
    expect(shellSegments('echo "$(ls; pwd)"', ps)).toEqual(["ls", " pwd", 'echo "$(ls; pwd)"']);
  });

  test("is text for an escaped $ and in single quotes", () => {
    expect(shellSegments('echo "\\$(ls)"')).toEqual(['echo "\\$(ls)"']);
    expect(shellSegments("echo '$(ls)'")).toEqual(["echo '$(ls)'"]);
  });

  test("drops what an unclosed $( ran — nothing in it ran", () => {
    expect(shellSegments('echo "$(ls; pwd')).toEqual(['echo "$(ls; pwd']);
  });
});

describe("shellSegments — a quote that never closes", () => {
  test("is text to the end by default", () => {
    expect(shellSegments('echo "a; ls')).toEqual(['echo "a; ls']);
    expect(shellSegments("echo 'a; ls")).toEqual(["echo 'a; ls"]);
  });

  test("is split on every separator when read blind, so nothing hides in it", () => {
    expect(shellSegments('echo "a; ls', { blindWhenOpen: true })).toEqual(['echo "a', " ls"]);
    expect(shellSegments('echo "a"; ls', { blindWhenOpen: true })).toEqual(['echo "a"', " ls"]);
    // Read blind, a bash backtick ends a command too.
    expect(shellSegments('echo "a; `ls`', { blindWhenOpen: true })).toEqual([
      'echo "a',
      " ",
      "ls",
      "",
    ]);
  });
});

describe("shellSegments — a line that goes on", () => {
  test("is cut at the line break unless the lines are joined, by each dialect's escape", () => {
    expect(shellSegments("a \\\n b")).toEqual(["a \\", " b"]);
    expect(shellSegments("a \\\n b", { joinLines: true })).toEqual(["a   b"]);
    expect(shellSegments("a \\  \r\n b", { joinLines: true })).toEqual(["a   b"]);
    expect(shellSegments("a `\n b", { ...ps, joinLines: true })).toEqual(["a   b"]);
    expect(shellSegments("a \\\n b", { ...ps, joinLines: true })).toEqual(["a \\", " b"]);
  });

  test("readingsOf: each dialect, and joined as well when a line ends in its escape", () => {
    expect(readingsOf("a", "bash")).toEqual([{ dialect: "bash", joinLines: false }]);
    expect(readingsOf("a \\\n b", "bash")).toEqual([
      { dialect: "bash", joinLines: false },
      { dialect: "bash", joinLines: true },
    ]);
    expect(readingsOf("a \\\n b")).toEqual([
      { dialect: "bash", joinLines: false },
      { dialect: "bash", joinLines: true },
      { dialect: "powershell", joinLines: false },
    ]);
  });
});

describe("shellSteps — the command piped into each one", () => {
  test("names the text of the command before a pipe", () => {
    expect(shellSteps("echo hi | sh; ls")).toEqual([
      { text: "echo hi ", pipedFrom: null, expanded: false, start: 0 },
      { text: " sh", pipedFrom: "echo hi ", expanded: false, start: 9 },
      { text: " ls", pipedFrom: null, expanded: false, start: 13 },
    ]);
  });

  // The job route's follow-up: `tsc 2>&1 | tail` was read as `tsc 2>`, a command `1`, and a
  // `tail` piped from that `1`, so a heavy command with its stderr sent on was never routable.
  test("the & of 2>&1, >&2 and &>log is part of the redirection, not a separator", () => {
    expect(shellSteps("tsc --noEmit 2>&1 | tail -20")).toEqual([
      { text: "tsc --noEmit 2>&1 ", pipedFrom: null, expanded: false, start: 0 },
      { text: " tail -20", pipedFrom: "tsc --noEmit 2>&1 ", expanded: false, start: 19 },
    ]);
    expect(shellSegments("echo x >&2; ls")).toEqual(["echo x >&2", " ls"]);
    expect(shellSegments("make &>build.log && ls")).toEqual(["make &>build.log ", "", " ls"]);
    expect(shellSegments("Get-Item x 2>&1; ls", { dialect: "powershell" })).toEqual([
      "Get-Item x 2>&1",
      " ls",
    ]);
    // A lone `&` still sends a command to the background, and `&&` still separates.
    expect(shellSegments("sleep 5 & ls")).toEqual(["sleep 5 ", " ls"]);
    expect(shellSegments("a && b")).toEqual(["a ", "", " b"]);
    // An escaped `>` is a character, so the `&` after it is a separator again.
    expect(shellSegments("echo a\\>& ls")).toEqual(["echo a\\>", " ls"]);
  });
});

describe("shellSteps: where each command starts in the line", () => {
  /** The step texts with their offsets, as `[start, text]`. */
  const starts = (line: string) =>
    shellSteps(line).map((step) => [step.start, step.text] as [number | undefined, string]);

  test("a command's offset is the character after the separator that ended the one before", () => {
    expect(starts("git add -A && git commit -m x")).toEqual([
      [0, "git add -A "],
      [12, ""],
      [13, " git commit -m x"],
    ]);
    expect(starts("a;b\nc")).toEqual([
      [0, "a"],
      [2, "b"],
      [4, "c"],
    ]);
  });

  test("a command inside ( … ) or a substitution has its own offset in the same line", () => {
    expect(starts("(cd a; git push)")).toEqual([
      [0, ""],
      [1, "cd a"],
      [6, " git push"],
      [16, ""],
    ]);
    expect(starts("echo $(git rev-parse HEAD) x")).toEqual([
      [7, "git rev-parse HEAD"],
      [0, "echo $(git rev-parse HEAD) x"],
    ]);
  });

  test("what is read out of another text has no offset: a backtick, a here-doc body", () => {
    expect(starts("echo `git push`")).toEqual([
      [undefined, "git push"],
      [0, "echo `git push`"],
    ]);
    expect(starts("sh <<EOF\ngit push\nEOF\nls")).toEqual([
      [0, "sh <<EOF"],
      [undefined, "git push"],
      [undefined, ""],
      [22, "ls"],
    ]);
  });

  test("a reading that joins escaped line breaks rewrites the text, so its steps have no offset", () => {
    const steps = shellSteps("git commit -m x \\\n  --no-verify", { joinLines: true });
    expect(steps.map((step) => step.start)).toEqual([undefined]);
    expect(shellSteps("git commit -m x \\\n  --no-verify").map((step) => step.start)).toEqual([
      0, 18,
    ]);
  });

  test("the commands of a bash array's list are marked, no other group is", () => {
    const array = (line: string) =>
      shellSteps(line)
        .filter((step) => step.text.trim().startsWith("git"))
        .map((step) => step.subshell?.array ?? false);
    expect(array("cmd=(git push)")).toEqual([true]);
    expect(array("args+=(git push)")).toEqual([true]);
    expect(array("declare -a a=( git push )")).toEqual([true]);
    expect(array("a=(\n git push\n)")).toEqual([true]);
    expect(array("(git push)")).toEqual([false]);
    expect(array("x=$(git push)")).toEqual([false]);
    expect(array("echo hi; (git push)")).toEqual([false]);
    // Inside the list, a substitution is a command again.
    expect(array("a=($(git push))")).toEqual([false]);
  });

  test("a here-doc body cut out of a substitution leaves the text before its first line break whole", () => {
    const line = "git commit -m \"$(cat <<'EOF'\nmsg\nEOF\n)\"";
    // The substitution's own command comes first (`cat <<'EOF'`, at 17); the git command is last.
    const step = shellSteps(line).find((one) => one.text.startsWith("git commit"));
    expect(step?.start).toBe(0);
    // The body is cut out of the text, so the whole text is no slice of the line any more …
    expect(line.startsWith(step?.text ?? "x", step?.start)).toBe(false);
    // … but the text before its first line break is.
    expect(line.startsWith((step?.text ?? "").split("\n")[0] ?? "x", step?.start)).toBe(true);
  });
});

describe("wordsOf", () => {
  test("removes the quotes around a piece and keeps the ones inside", () => {
    expect(wordsOf("git commit -m \"a b\" 'c d'")).toEqual(["git", "commit", "-m", "a b", "c d"]);
    expect(wordsOf(`bash -c 'echo "x; y"'`)).toEqual(["bash", "-c", 'echo "x; y"']);
    expect(wordsOf('echo "say \\"hi\\""')).toEqual(["echo", 'say "hi"']);
    expect(wordsOf('--subject="a b"x')).toEqual(["--subject=a bx"]);
    expect(wordsOf("a '' b")).toEqual(["a", "", "b"]);
  });

  test("HK-8: resolves escapes and ANSI-C quotes, as the shell does before the program runs", () => {
    expect(wordsOf("g\\it ma\\in")).toEqual(["git", "main"]);
    expect(wordsOf("$'git' $'\\x67it' $'\\147it' $'a\\'b'")).toEqual(["git", "git", "git", "a'b"]);
    expect(wordsOf('"C:\\Git\\git.exe" "a\\$b"')).toEqual(["C:\\Git\\git.exe", "a$b"]);
    expect(wordsOf("a\\\nb")).toEqual(["ab"]);
    // PowerShell: the backtick escapes; a backslash and `''` are what they say.
    expect(wordsOf("g`it C:\\Git 'it''s' \"a`\"b\"", "powershell")).toEqual([
      "git",
      "C:\\Git",
      "it's",
      'a"b',
    ]);
  });

  test("makes a redirection a word of its own, with its file number", () => {
    expect(wordsOf("git push origin main>log 2>&1")).toEqual([
      "git",
      "push",
      "origin",
      "main",
      ">log",
      "2>&1",
    ]);
    // A quoted or escaped `>` is a character.
    expect(wordsOf('echo "a>b" x\\>y')).toEqual(["echo", "a>b", "x>y"]);
    expect(withoutRedirections(["push", "origin", ">", "out", "2>", "<in"])).toEqual([
      "push",
      "origin",
    ]);
  });
});

describe("wordsOf: bash's `&>file` and `&>>file` are one redirection", () => {
  test("the bare & belongs to the redirection, attached or apart", () => {
    expect(wordsOf("tsc a.ts &>/dev/null")).toEqual(["tsc", "a.ts", "&>/dev/null"]);
    expect(wordsOf("tsc a.ts &>>log")).toEqual(["tsc", "a.ts", "&>>log"]);
    expect(wordsOf("tsc a.ts &> out.txt")).toEqual(["tsc", "a.ts", "&>", "out.txt"]);
    expect(withoutRedirections(wordsOf("tsc a.ts &>/dev/null").slice(1))).toEqual(["a.ts"]);
    expect(withoutRedirections(wordsOf("tsc a.ts &>>log").slice(1))).toEqual(["a.ts"]);
    expect(withoutRedirections(wordsOf("tsc a.ts &> out.txt").slice(1))).toEqual(["a.ts"]);
    expect(withoutRedirections(wordsOf("tsc a.ts &>> out.txt").slice(1))).toEqual(["a.ts"]);
    expect(redirectionTargets(wordsOf("tsc a.ts &>> out.txt"))).toEqual(["out.txt"]);
    expect(redirectionTargets(wordsOf("tsc a.ts &>/dev/null"))).toEqual(["/dev/null"]);
    expect(redirectionTargets(wordsOf("tsc a.ts &>>log"))).toEqual(["log"]);
  });

  test("attached to the word before it, the & still starts the redirection", () => {
    expect(wordsOf("git reset --hard&>/dev/null")).toEqual([
      "git",
      "reset",
      "--hard",
      "&>/dev/null",
    ]);
    expect(wordsOf("make all&>>log")).toEqual(["make", "all", "&>>log"]);
    expect(redirectionTargets(wordsOf("make all&>log"))).toEqual(["log"]);
  });

  test("a quoted or escaped & is a character, and PowerShell has no such operator", () => {
    expect(wordsOf("echo '&'>x")).toEqual(["echo", "&", ">x"]);
    expect(wordsOf("echo \\&>x")).toEqual(["echo", "&", ">x"]);
    expect(wordsOf("tsc a.ts &>x", "powershell")).toEqual(["tsc", "a.ts", "&", ">x"]);
  });
});

describe("redirectionTargets: `>&` followed by a word is a write", () => {
  test("a file after `>&`, attached or apart, is a target; a descriptor is not", () => {
    expect(redirectionTargets(wordsOf("echo x >&out.txt"))).toEqual(["out.txt"]);
    expect(redirectionTargets(wordsOf("echo x >& out.txt"))).toEqual(["out.txt"]);
    expect(redirectionTargets(wordsOf("echo x 2>& out.txt"))).toEqual(["out.txt"]);
    expect(redirectionTargets(wordsOf("echo x >&2"))).toEqual([]);
    expect(redirectionTargets(wordsOf("echo x >& 2"))).toEqual([]);
    expect(redirectionTargets(wordsOf("echo x 2>&1"))).toEqual([]);
    expect(redirectionTargets(wordsOf("echo x >&-"))).toEqual([]);
    expect(redirectionTargets(wordsOf("echo x >& -"))).toEqual([]);
    expect(redirectionTargets(wordsOf("echo x >& /dev/null"))).toEqual(["/dev/null"]);
  });
});

describe("wordsOf: a substitution is one word", () => {
  test("$( … ) keeps its spaces and redirections, outside quotes and inside them", () => {
    expect(wordsOf("out=$(bun test 2>&1)")).toEqual(["out=$(bun test 2>&1)"]);
    expect(wordsOf("echo $(a b) c")).toEqual(["echo", "$(a b)", "c"]);
    expect(wordsOf("echo $(a $(b c)) d")).toEqual(["echo", "$(a $(b c))", "d"]);
    expect(wordsOf('x="$(a "b c")" d')).toEqual(['x=$(a "b c")', "d"]);
    expect(wordsOf("echo $(a ')' b) c")).toEqual(["echo", "$(a ')' b)", "c"]);
  });

  test("bash's <( … ) and >( … ) at the start of a word, never after one", () => {
    expect(wordsOf("diff <(sort a) <(sort b)")).toEqual(["diff", "<(sort a)", "<(sort b)"]);
    expect(wordsOf("cmd > >(tee x)")).toEqual(["cmd", ">", ">(tee x)"]);
    // The shell puts a file of its own there: no file of the line's.
    expect(redirectionTargets(wordsOf("cmd > >(tee x)"))).toEqual([]);
    // Not a redirection: the program gets a file name in its place.
    expect(redirectionTargets(wordsOf("cmd >(tee x)"))).toEqual([]);
    expect(withoutRedirections(wordsOf("diff <(a) <(b)").slice(1))).toEqual(["<(a)", "<(b)"]);
  });

  test("a $'…' quote or a backtick inside it is text: its ) closes nothing (review 3, M2)", () => {
    expect(wordsOf("echo $(printf $'\\'') > X \"')\"")).toEqual([
      "echo",
      "$(printf $'\\'')",
      ">",
      "X",
      "')",
    ]);
    expect(redirectionTargets(wordsOf("echo $(printf $'\\'') > X \"')\""))).toEqual(["X"]);
    expect(wordsOf("echo $(echo `echo )`) y")).toEqual(["echo", "$(echo `echo )`)", "y"]);
    expect(wordsOf('echo "$(a "$(b ")")")" z')).toEqual(["echo", '$(a "$(b ")")")', "z"]);
  });

  test("a quoted or escaped ( after > is a file's name, not a process substitution (review 3, L5)", () => {
    expect(redirectionTargets(wordsWithFill("echo x >\\(foo"))).toEqual(["(foo"]);
    expect(redirectionTargets(wordsWithFill('echo x >"(foo"'))).toEqual(["(foo"]);
    expect(redirectionTargets(wordsWithFill('echo x > "(foo"'))).toEqual(["(foo"]);
    expect(redirectionTargets(wordsWithFill("cmd > >(tee x)"))).toEqual([]);
    expect(redirectionTargets(wordsWithFill("cmd >(tee x)"))).toEqual([]);
  });

  test("$$ is the shell's process id, so the $ after it starts nothing (review 4)", () => {
    // The `'` after `$$` opens a plain quote, so the second `'` is a comment's.
    expect(shellSteps("echo $$'\\' > P #'").map((step) => step.text)).toEqual(["echo $$'\\' > P "]);
    expect(wordsOf("echo $$'\\' > P ")).toEqual(["echo", "$$\\", ">", "P"]);
    expect(wordsWithFill("echo $$ x")[1]).toEqual({ filled: true, text: "$$" });
  });

  test("an unclosed one, and PowerShell, split as before", () => {
    expect(wordsOf("echo $(a b")).toEqual(["echo", "$(a", "b"]);
    expect(wordsOf("echo $(a b) c", "powershell")).toEqual(["echo", "$(a", "b)", "c"]);
  });
});

describe("shellSteps: the group each command runs in", () => {
  test("commands of one group share it; groups side by side are two", () => {
    const [first, second, outer] = shellSteps("echo $(cd a) $(touch b)");
    expect(first?.text).toBe("cd a");
    expect(second?.text).toBe("touch b");
    expect(first?.subshell?.depth).toBe(1);
    expect(second?.subshell?.depth).toBe(1);
    expect(first?.subshell === second?.subshell).toBe(false);
    expect(outer?.subshell).toBeUndefined();
  });

  test("a group inside a group points back to it", () => {
    const steps = shellSteps("(cd a; (touch b))");
    const inner = steps.find((step) => step.text === "touch b")?.subshell;
    const outer = steps.find((step) => step.text === "cd a")?.subshell;
    expect(inner?.depth).toBe(2);
    expect(inner?.outer === outer).toBe(true);
  });

  test("a process substitution keeps its word whole and runs its commands one group in", () => {
    const steps = shellSteps("cmd > >(tee x)");
    expect(steps.map((step) => step.text)).toEqual(["tee x", "cmd > >(tee x)"]);
    expect(steps[0]?.subshell?.depth).toBe(1);
  });

  test("a case pattern's ) closes neither a group nor a substitution", () => {
    const steps = shellSteps("x=$(case y in a) echo one;; (b) echo two;; esac); touch c");
    expect(steps.map((step) => [step.text.trim(), step.subshell?.depth ?? 0])).toEqual([
      ["case y in a", 1],
      ["echo one", 1],
      ["", 1],
      ["", 1],
      ["b", 1],
      ["echo two", 1],
      ["", 1],
      ["esac", 1],
      ["x=$(case y in a) echo one;; (b) echo two;; esac)", 0],
      ["touch c", 0],
    ]);
  });
});

describe("redirectionTargets — the files a command's words write", () => {
  test("every writing operator, attached or apart, before or after the program", () => {
    expect(
      redirectionTargets(["echo", "x", ">a", ">>", "b", ">|c", "&>d", "&>>e", "2>f", "<>g"]),
    ).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(redirectionTargets([">log", "echo"])).toEqual(["log"]);
    expect(redirectionTargets(wordsOf("echo x>log 2> err"))).toEqual(["log", "err"]);
  });

  test("a read, a here-doc, a here-string and a descriptor write no file", () => {
    expect(redirectionTargets(["cat", "<in", "<", "in2", "<<EOF", "<<<", "text"])).toEqual([]);
    expect(redirectionTargets(["cmd", "2>&1", ">&2", ">&-", "1>&2"])).toEqual([]);
    // `>&file` sends both streams to a file.
    expect(redirectionTargets(["cmd", ">&log"])).toEqual(["log"]);
  });

  test("a quoted or escaped `>` is a character, not a redirection", () => {
    expect(redirectionTargets(wordsOf('echo "a>b" x\\>y'))).toEqual([]);
  });
});

describe("bash's `>|` is a redirect, not a pipe", () => {
  test("the file after it is its target, not a command; a real pipe still splits", () => {
    expect(shellSegments("echo x >| out.txt")).toEqual(["echo x >| out.txt"]);
    expect(shellSegments("echo x > a | tee b")).toEqual(["echo x > a ", " tee b"]);
    expect(shellSegments("echo x \\>| tee b")).toEqual(["echo x \\>", " tee b"]);
    expect(shellSegments('echo ">" | tee b')).toEqual(['echo ">" ', " tee b"]);
  });
});

describe("invocationOf", () => {
  test("append assignments keep the following program", () => {
    expect(invocationOf(["A+=1", "git", "push", "--force"])).toEqual({
      program: "git",
      args: ["push", "--force"],
      computed: false,
      prefix: ["A+=1"],
    });
    expect(invocationOf(["_A1+=value"])).toBeUndefined();
    expect(invocationOf(["1A+=value", "git"])?.program).toBe("1a+=value");
  });
  test("finds the program behind assignments, keywords, redirections and wrappers", () => {
    expect(invocationOf(["CI=1", "sudo", "/usr/bin/gh.exe", "pr"])).toEqual({
      args: ["pr"],
      computed: false,
      prefix: ["CI=1", "sudo"],
      program: "gh",
    });
    expect(invocationOf(["A=1"])).toBeUndefined();
    expect(invocationOf(["command", "-v", "git"])).toBeUndefined();
    expect(invocationOf(["if", "!", "git", "x"])?.program).toBe("git");
    expect(invocationOf(["2>/dev/null", ">", "out", "git", "x"])?.program).toBe("git");
  });

  test("CM-9 and HK-10: steps over a wrapper's own options", () => {
    for (const words of [
      ["time", "-p", "git", "x"],
      ["env", "-i", "PATH=/x", "git", "x"],
      ["env", "-u", "HOME", "git", "x"],
      ["/usr/bin/env", "git", "x"],
      ["sudo", "-u", "me", "-E", "git", "x"],
      ["doas", "-u", "me", "git", "x"],
      ["timeout", "-s", "KILL", "60", "git", "x"],
      ["nice", "-n", "5", "ionice", "-c", "3", "git", "x"],
      ["xargs", "-I", "{}", "git", "x"],
      ["stdbuf", "-oL", "git", "x"],
    ]) {
      expect({ words, program: invocationOf(words)?.program }).toEqual({ words, program: "git" });
    }
  });

  test("`cross-env` runs the program after its VAR=x words, like env does", () => {
    expect(invocationOf(["cross-env", "NODE_ENV=test", "CI=1", "git", "push", "-f"])).toEqual({
      args: ["push", "-f"],
      computed: false,
      prefix: ["cross-env", "NODE_ENV=test", "CI=1"],
      program: "git",
    });
    expect(invocationOf(["./node_modules/.bin/cross-env", "A=1", "jest"])?.program).toBe("jest");
    expect(invocationOf(["CI=1", "cross-env.cmd", "A=1", "sudo", "git", "push"])?.program).toBe(
      "git",
    );
    // With no VAR=x word, the command after it still runs; with nothing after it, nothing runs.
    expect(invocationOf(["cross-env", "git", "x"])?.program).toBe("git");
    expect(invocationOf(["cross-env", "A=1"])).toBeUndefined();
  });

  test("HK-9: `env -S` splits its string into the command's words", () => {
    expect(invocationOf(["env", "-S", "git push -f", "origin"])).toEqual({
      args: ["push", "-f", "origin"],
      computed: false,
      prefix: ["env"],
      program: "git",
    });
    expect(invocationOf(["env", "-S-i FOO=1 git push"])?.args).toEqual(["push"]);
    expect(invocationOf(["env", "-iS", "git push"])?.prefix).toEqual(["env", "-i"]);
    expect(invocationOf(["env", "--split-string=git push"])?.program).toBe("git");
  });

  test("F2a-1: setsid, flock, chrt, taskset, unbuffer and nsenter run the program after them", () => {
    for (const words of [
      ["setsid", "git", "push", "-f"],
      ["flock", "/tmp/l", "git", "push", "-f"],
      ["flock", "42", "git", "push"],
      ["chrt", "-f", "50", "git", "push"],
      ["chrt", "--sched-runtime", "1000", "50", "git", "push"],
      ["taskset", "-c", "0-3", "git", "push"],
      ["taskset", "0x3", "git", "push"],
      ["unbuffer", "git", "push"],
      ["nsenter", "-t", "1", "-m", "git", "push"],
    ]) {
      expect({ program: invocationOf(words)?.program, words }).toEqual({ program: "git", words });
    }
  });

  test("F2a-1: `script -c`, `flock -c` and `busybox` read the command inside them", () => {
    expect(invocationOf(["script", "-qc", "git push -f origin main"])).toEqual({
      args: ["push", "-f", "origin", "main"],
      computed: false,
      prefix: ["script"],
      program: "git",
    });
    expect(invocationOf(["flock", "/tmp/l", "-c", "git push -f"])).toEqual({
      args: ["push", "-f"],
      computed: false,
      prefix: ["flock", "/tmp/l"],
      program: "git",
    });
    expect(invocationOf(["script", "/tmp/log", "git", "push"])?.program).toBe("git");
    expect(invocationOf(["busybox", "sh", "-c", "git push -f"])?.program).toBe("sh");
    expect(invocationOf(["busybox", "--list"])).toBeUndefined();
  });

  test("F2a-1: ksh, mksh and fish run the script they are given with -c", () => {
    for (const shell of ["ksh", "mksh", "fish"]) {
      expect(programsOf(`${shell} -c 'git push -f origin main'`)).toEqual([shell, "git"]);
      expect(programsOf(`busybox ${shell} -c 'git push -f origin main'`)).toEqual([shell, "git"]);
    }
  });

  test("F2a-1: npx, bunx and pnpm dlx of @anthropic-ai/claude-code are claude", () => {
    expect(invocationOf(["npx", "@anthropic-ai/claude-code", "--bg", "x"])).toEqual({
      args: ["--bg", "x"],
      computed: false,
      prefix: [],
      program: "claude",
    });
    expect(invocationOf(["npx", "-y", "@anthropic-ai/claude-code", "--bg"])?.program).toBe(
      "claude",
    );
    expect(invocationOf(["bunx", "@anthropic-ai/claude-code", "--bg"])?.program).toBe("claude");
    expect(invocationOf(["pnpm", "dlx", "@anthropic-ai/claude-code", "--bg"])?.program).toBe(
      "claude",
    );
    expect(invocationOf(["npx", "-p", "@anthropic-ai/claude-code", "claude", "--bg"])).toEqual({
      args: ["--bg"],
      computed: false,
      prefix: [],
      program: "claude",
    });
    // Any other package is the runner's own: the reader does not guess at what it runs.
    expect(invocationOf(["npx", "tsc", "--noEmit"])?.program).toBe("npx");
  });

  test("F2a-1: a program named by an expansion or a substitution is marked computed", () => {
    expect(invocationOf(wordsOf("$GIT push origin HEAD"))).toEqual({
      args: ["push", "origin", "HEAD"],
      computed: true,
      prefix: [],
      program: "$git",
    });
    expect(invocationOf(wordsOf("$(which git) push --force"))?.computed).toBe(true);
    expect(invocationOf(wordsOf(`\${GIT} push`))?.computed).toBe(true);
    expect(invocationOf(wordsOf("`which git` push"))?.computed).toBe(true);
    expect(invocationOf(wordsOf("echo $(which git)"))?.computed).toBe(false);
  });

  test("F2a-3: Start-Process runs what -FilePath and -ArgumentList name", () => {
    const one = (line: string) => invocationOf(wordsOf(line, "powershell"));
    expect(one("Start-Process -FilePath git -ArgumentList 'push -f origin main'")).toEqual({
      args: ["push", "-f", "origin", "main"],
      computed: false,
      prefix: [],
      program: "git",
    });
    expect(one("Start-Process git 'push -f origin main'")).toEqual({
      args: ["push", "-f", "origin", "main"],
      computed: false,
      prefix: [],
      program: "git",
    });
    expect(one("Start-Process cc-smart-dev-kit -ArgumentList portal -UseNewEnvironment")).toEqual({
      args: ["portal"],
      computed: false,
      prefix: ["start-process", "-UseNewEnvironment"],
      program: "cc-smart-dev-kit",
    });
  });
});

describe("the runners: find -exec, watch, su -c and parallel run the command they name", () => {
  // The finding of the GI1 review: only the issue-write guard knew these four, so
  // `watch git push` and `find . -exec git push \;` got past the git guard. The reader knows
  // them once, beside `bash -c`, and every guard that walks the nesting sees the inner program.
  test("find: every -exec, -execdir, -ok and -okdir up to its `;` or `+`", () => {
    expect(nestedCommand("find", [".", "-exec", "git", "push", ";"])).toBe("'git' 'push'");
    expect(nestedCommand("find", [".", "-exec", "git", "push", "{}", "+"])).toBe(
      "'git' 'push' '{}'",
    );
    expect(nestedCommand("find", [".", "-execdir", "a", ";", "-ok", "b", "c", ";"])).toBe(
      "'a' ; 'b' 'c'",
    );
    expect(nestedCommand("find", [".", "-maxdepth", "0", "-okdir", "gh", "pr", "merge", ";"])).toBe(
      "'gh' 'pr' 'merge'",
    );
    // A second -exec after a harmless first one is still read.
    expect(nestedCommand("find", [".", "-exec", "true", ";", "-exec", "git", "push", ";"])).toBe(
      "'true' ; 'git' 'push'",
    );
    expect(nestedCommand("find", [".", "-name", "x", "-print"])).toBeUndefined();
    // No terminator: find itself refuses it, but what follows is still what would run.
    expect(nestedCommand("find", [".", "-exec", "git", "push"])).toBe("'git' 'push'");
  });

  test("watch: the command after its options, as the shell it runs it in reads it", () => {
    expect(nestedCommand("watch", ["git", "push"])).toBe("git push");
    expect(nestedCommand("watch", ["-n", "5", "git push"])).toBe("git push");
    expect(nestedCommand("watch", ["-n5", "--color", "git", "push"])).toBe("git push");
    expect(nestedCommand("watch", ["--interval=2", "-d", "git push"])).toBe("git push");
    expect(nestedCommand("watch", ["-x", "git", "push"])).toBe("'git' 'push'");
    expect(nestedCommand("watch", ["--", "git", "push"])).toBe("git push");
    expect(nestedCommand("watch", ["-n", "5"])).toBeUndefined();
  });

  test("su: the -c or --command string, wherever the user stands", () => {
    expect(nestedCommand("su", ["-c", "git push", "user"])).toBe("git push");
    expect(nestedCommand("su", ["-", "user", "-c", "git push"])).toBe("git push");
    expect(nestedCommand("su", ["--command=git push", "user"])).toBe("git push");
    expect(nestedCommand("su", ["--command", "git push"])).toBe("git push");
    expect(nestedCommand("su", ["-lc", "git push"])).toBe("git push");
    expect(nestedCommand("su", ["-s", "/bin/sh", "-c", "git push", "me"])).toBe("git push");
    expect(nestedCommand("su", ["user"])).toBeUndefined();
    expect(nestedCommand("su", ["-"])).toBeUndefined();
  });

  test("parallel: the command before its `:::` arguments, after its own options", () => {
    expect(nestedCommand("parallel", ["git push {}", ":::", "a", "b"])).toStartWith("git push {}");
    expect(nestedCommand("parallel", ["git", "push", "{}", ":::", "a"])).toStartWith("git push {}");
    expect(nestedCommand("parallel", ["-j", "4", "git", "push", ":::", "a"])).toStartWith(
      "git push",
    );
    expect(nestedCommand("parallel", ["--jobs=4", "-k", "git push", "::::", "list"])).toStartWith(
      "git push",
    );
    expect(nestedCommand("parallel", ["-j4", "--bar", "git push"])).toBe("git push");
    // No command and no `:::` arguments: parallel reads its commands from standard input, which
    // cannot be read. (With `:::` arguments and no command, they are the commands: see below.)
    expect(nestedCommand("parallel", ["-j", "4"])).toBeUndefined();
  });

  // The review of the follow-up: each spelling below hid the inner program from a guard.
  test("review: watch's -q/--equexit take a value, and a unique long prefix is the option", () => {
    expect(nestedCommand("watch", ["-q", "3", "git push"])).toBe("git push");
    expect(nestedCommand("watch", ["--equexit", "3", "git", "push"])).toBe("git push");
    expect(nestedCommand("watch", ["--int", "5", "git", "push"])).toBe("git push");
    expect(nestedCommand("watch", ["--inter=5", "git", "push"])).toBe("git push");
  });

  test("review: find's `+` ends -exec only after {}; an escaped `\\;` word is an argument", () => {
    expect(nestedCommand("find", [".", "-exec", "echo", "+", "hi", ";"])).toBe("'echo' '+' 'hi'");
    expect(nestedCommand("find", [".", "-exec", "flock", "+", "git", "push", ";"])).toBe(
      "'flock' '+' 'git' 'push'",
    );
    expect(nestedCommand("find", [".", "-exec", "echo", "\\;", "hi", ";"])).toBe(
      "'echo' '\\;' 'hi'",
    );
    expect(nestedCommand("find", [".", "-exec", "a", "{}", "+", "-exec", "b", ";"])).toBe(
      "'a' '{}' ; 'b'",
    );
  });

  test("review: su after `--`, --session-command, and a long prefix", () => {
    expect(nestedCommand("su", ["--", "me", "-c", "git push"])).toBe("git push");
    expect(nestedCommand("su", ["--session-command", "git push", "me"])).toBe("git push");
    expect(nestedCommand("su", ["--session-command=git push", "me"])).toBe("git push");
    expect(nestedCommand("su", ["--comm", "git push"])).toBe("git push");
    expect(nestedCommand("su", ["--", "me"])).toBeUndefined();
  });

  test("review: parallel's boolean -u, its valued -C -s -J, and its long options", () => {
    expect(nestedCommand("parallel", ["-u", "git", "push", ":::", "a"])).toStartWith("git push");
    expect(nestedCommand("parallel", ["-C", ",", "git push", ":::", "a"])).toStartWith("git push");
    expect(nestedCommand("parallel", ["-s", "100", "git push", ":::", "a"])).toStartWith(
      "git push",
    );
    expect(nestedCommand("parallel", ["-J", "prof", "git push", ":::", "a"])).toStartWith(
      "git push",
    );
    expect(nestedCommand("parallel", ["--delay", "1", "git", "push", ":::", "a"])).toStartWith(
      "git push",
    );
    expect(nestedCommand("parallel", ["--tagstring", "x", "git push", ":::", "a"])).toStartWith(
      "git push",
    );
    expect(nestedCommand("parallel", ["--arg-sep", ",,", "git push", ",,", "a"])).toStartWith(
      "git push",
    );
  });

  test("review: parallel with no command runs its arguments; an unknown option is read both ways", () => {
    expect(nestedCommand("parallel", [":::", "git push -f"])).toBe("git push -f");
    expect(nestedCommand("parallel", [":::", "a", "b"])).toBe("a ; b");
    expect(nestedCommand("parallel", ["-j", "4"])).toBeUndefined();
    // An option this reader does not know may take the next word or not: both readings are
    // returned, so the command is in the line either way.
    const readings = (
      nestedCommand("parallel", ["--surprise", "git", "push", ":::", "a"]) ?? ""
    ).split(" ; ");
    expect(readings).toContain("git push");
    expect(readings).toContain("push");
  });

  // The second review of the follow-up.
  test("review 2: watch's -d takes its value only attached, so the next word is the command", () => {
    expect(nestedCommand("watch", ["-dq", "git", "push", "-f"])).toBe("git push -f");
    expect(nestedCommand("watch", ["-dn", "git", "push", "-f"])).toBe("git push -f");
    expect(nestedCommand("watch", ["-d", "git", "push"])).toBe("git push");
    // -n before d still takes the next word (`-nd 1` is `-n` with the value `d`, then `1`).
    expect(nestedCommand("watch", ["-n", "5", "-d", "git", "push"])).toBe("git push");
    expect(nestedCommand("watch", ["-xd", "git", "push"])).toBe("'git' 'push'");
  });

  test("review 2: parallel adds its `:::` arguments to the command, quoted, or puts them at {}", () => {
    const lines = (args: string[]) => (nestedCommand("parallel", args) ?? "").split(" ; ");
    expect(lines(["git", "push", ":::", "-f"])).toContain("git push '-f'");
    expect(lines(["gh", "issue", ":::", "create"])).toContain("gh issue 'create'");
    expect(lines(["bash", "-c", ":::", "git push -f"])).toContain("bash -c 'git push -f'");
    expect(lines(["git push {}", ":::", "a", "b"])).toContain("git push 'a' 'b'");
    // A shell as the command runs each later argument as a script of its own.
    expect(lines(["sh", "-c", "{}", ":::", "git push -f"])).toContain("git push -f");
    // A command that is no shell does not turn its arguments into commands.
    expect(lines(["echo", ":::", "git push -f"])).not.toContain("git push -f");
  });

  test("review 2: parallel's unknown valued options never hide the command, however many", () => {
    const said = nestedCommand("parallel", [
      "--tmpdir",
      "/tmp",
      "--wd",
      ".",
      "--ssh",
      "ssh",
      "--foo",
      "x",
      "git",
      "push",
      "-f",
      ":::",
      "a",
    ]);
    expect(said?.split(" ; ")).toContain("git push -f");
  });

  test("review 2: find's valued tests (-name -exec) do not start a command", () => {
    expect(nestedCommand("find", [".", "-name", "-exec", "-exec", "git", "push", ";"])).toBe(
      "'git' 'push'",
    );
    expect(nestedCommand("find", [".", "-name", "-exec"])).toBeUndefined();
  });

  test("review: `{}` as the program is a program worked out when the line runs", () => {
    expect(invocationOf(["{}", "push", "-f"])?.computed).toBe(true);
    expect(invocationOf(["git", "push"])?.computed).toBe(false);
  });

  test("programsOf sees the inner program, behind a wrapper too", () => {
    expect(programsOf("find . -exec git push \\;")).toEqual(["find", "git"]);
    // In Bash. PowerShell reads `\;` as a separator, so a line with no dialect named also holds
    // the words it leaves behind (`-exec`) as a program.
    expect(programsOf("find . -exec true \\; -exec git push \\;", "bash")).toEqual([
      "find",
      "true",
      "git",
    ]);
    expect(programsOf("watch -n 5 git push")).toEqual(["watch", "git"]);
    expect(programsOf("watch 'git push'")).toEqual(["watch", "git"]);
    expect(programsOf('su -c "git push" user')).toEqual(["su", "git"]);
    // The command, and again with its `:::` arguments added to it (parallel does): `git` twice.
    expect(programsOf("parallel git push ::: a b")).toEqual(["parallel", "git", "git"]);
    expect(programsOf("parallel git push")).toEqual(["parallel", "git"]);
    expect(programsOf("sudo watch git push")).toEqual(["watch", "git"]);
    expect(programsOf("timeout 9 find . -exec git push {} +", "bash")).toEqual(["find", "git"]);
    expect(programsOf("find . -name x")).toEqual(["find"]);
    expect(programsOf("watch ls")).toEqual(["watch", "ls"]);
  });

  test("a runner inside a shell inside a runner is read three levels deep", () => {
    expect(programsOf("watch \"bash -c 'git push'\"")).toEqual(["watch", "bash", "git"]);
    expect(programsOf("bash -c 'find . -exec git push \\;'", "bash")).toEqual([
      "bash",
      "find",
      "git",
    ]);
  });
});

describe("nestedCommand and nestedDialect", () => {
  test("reads the inner command of a wrapper", () => {
    expect(nestedCommand("bash", ["-lc", "ls; pwd"])).toBe("ls; pwd");
    expect(nestedCommand("cmd", ["/c", "dir", "C:\\"])).toBe("dir C:\\");
    expect(nestedCommand("pwsh", ["-Com", "ls", "-la"])).toBe("ls -la");
    expect(nestedCommand("eval", ["ls", "a"])).toBe("ls a");
    expect(nestedCommand("git", ["-c", "x"])).toBeUndefined();
  });

  test("HK-9: bash's command string is the first word that is no option, wherever -c stands", () => {
    expect(nestedCommand("bash", ["-c", "--", "ls"])).toBe("ls");
    expect(nestedCommand("bash", ["-c", "-e", "ls"])).toBe("ls");
    expect(nestedCommand("bash", ["-O", "extglob", "-c", "ls"])).toBe("ls");
    expect(nestedCommand("bash", ["-c", "-o", "pipefail", "ls"])).toBe("ls");
    expect(nestedCommand("bash", ["--norc", "-ec", "ls"])).toBe("ls");
    expect(nestedCommand("bash", ["script.sh", "-c", "ls"])).toBeUndefined();
  });

  test("HK: `claude plugin eval` is not the shell's eval", () => {
    // `eval` runs a line only as the program itself, or behind a wrapper (`command`, `builtin`).
    expect(programsOf("claude plugin eval . --eval-dir evals/cases")).toEqual(["claude"]);
    expect(programsOf('eval "git push --force"')).toEqual(["eval", "git"]);
    expect(programsOf('builtin eval "git status"')).toEqual(["eval", "git"]);
    expect(programsOf('command eval "git status"')).toEqual(["eval", "git"]);
  });

  test("reads the command a `job run` queues, quoted so it reads back the same", () => {
    expect(
      nestedCommand("cc-smart-dev-kit", ["job", "run", "--kind", "t", "--", "bash", "-c", "a; b"]),
    ).toBe("'bash' '-c' 'a; b'");
    expect(nestedCommand("cc-smart-dev-kit", ["job", "status"])).toBeUndefined();
  });

  test("the inner line of pwsh and iex is PowerShell; of the others, bash", () => {
    expect(["pwsh", "powershell", "iex", "invoke-expression"].map(nestedDialect)).toEqual([
      "powershell",
      "powershell",
      "powershell",
      "powershell",
    ]);
    expect(["bash", "sh", "eval", "cmd"].map(nestedDialect)).toEqual([
      "bash",
      "bash",
      "bash",
      "bash",
    ]);
  });
});

describe("the dialect of a tool, and the programs of a line", () => {
  test("dialectOfTool: Bash and PowerShell, nothing else", () => {
    expect(dialectOfTool("Bash")).toBe("bash");
    expect(dialectOfTool("PowerShell")).toBe("powershell");
    expect(dialectOfTool("Edit")).toBeUndefined();
    expect(dialectOfTool(undefined)).toBeUndefined();
  });

  test("programsOf: in one dialect, or both with each extra program PowerShell runs", () => {
    expect(programsOf('pwsh -c "git status"')).toEqual(["pwsh", "git"]);
    const paths = 'cd "C:\\a\\"; git status; cd "C:\\b\\"';
    expect(programsOf(paths, "bash")).toEqual(["cd"]);
    expect(programsOf(paths, "powershell")).toEqual(["cd", "git", "cd"]);
    expect(programsOf(paths)).toEqual(["cd", "git", "cd"]);
  });
});

describe("shortFlags — the value attached to a short option (IX1)", () => {
  test("IX1-2: one leading `=` is dropped, as gh's flag library reads `-X=POST`", () => {
    expect(shortFlags("-X=POST", "X")).toEqual({ flags: "X", value: "POST", wantsNext: false });
    expect(shortFlags("-XPOST", "X")).toEqual({ flags: "X", value: "POST", wantsNext: false });
    expect(shortFlags("-X==POST", "X")).toEqual({ flags: "X", value: "=POST", wantsNext: false });
    expect(shortFlags("-iX=PUT", "X")).toEqual({ flags: "iX", value: "PUT", wantsNext: false });
  });

  test("IX1-2: a letter with nothing attached takes the next word, and has no value here", () => {
    expect(shortFlags("-X", "X")).toEqual({ flags: "X", value: "", wantsNext: true });
    expect(shortFlags("-ab", "X")).toEqual({ flags: "ab", value: "", wantsNext: false });
  });
});

describe("wordsWithFill — which words the shell fills in (IX3)", () => {
  const filledOf = (segment: string, dialect: "bash" | "powershell" = "bash") =>
    wordsWithFill(segment, dialect).map((one) => one.filled);

  test("gives the same texts as wordsOf, each with its flag", () => {
    expect(wordsWithFill("gh api 'a b' \"$x\"")).toEqual([
      { text: "gh", filled: false },
      { text: "api", filled: false },
      { text: "a b", filled: false },
      { text: "$x", filled: true },
    ]);
    for (const line of [
      "git commit -m \"a b\" 'c d' main>log",
      'g\\it $\'\\x67it\' "a\\$b" $"t"',
    ]) {
      expect(wordsWithFill(line).map((one) => one.text)).toEqual(wordsOf(line));
    }
  });

  test("bash: an expansion outside single quotes is filled, in every spelling", () => {
    // `$(cat q)` is one word, the shell's answer; a backtick pair splits on its space: each piece
    // is a word of its own.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell text, read by the lexer under test.
    expect(filledOf("a $x ${x} $(cat q) $((1+2)) `cat q` $1 $? x$y")).toEqual([
      false, // a
      true, // $x
      true, // ${x}
      true, // $(cat q)
      true, // $((1+2))
      true, // `cat
      true, // q`
      true, // $1
      true, // $?
      true, // x$y
    ]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell text, read by the lexer under test.
    expect(filledOf('a "$x" "q=$(cat q)" "`cat q`" "pre${x}post"')).toEqual([
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(filledOf('a $"x $y"')).toEqual([false, true]);
  });

  test("bash: single quotes, $'…' and an escaped $ fill nothing", () => {
    expect(filledOf("a 'q($n)' '$x' '`x`' $'a$b' \\$x \"a\\$b\" \"a\\`b\"")).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    // A `$` before a character that makes it text (`$.`, `$~`) is text.
    expect(filledOf("a $. $~ 'x'$.")).toEqual([false, false, false, false]);
    expect(filledOf("a $-")).toEqual([false, true]);
  });

  test("a `$` the line reader cut off from what follows is filled: it may expand into anything", () => {
    // The line reader joins `$\<newline>P` into `$ P` and cuts PowerShell's `${env:P}` at its
    // brace, so the word ends in a lone `$`. A lone `$` is never a word to trust as text.
    expect(filledOf("a repos/o/r/$ P")).toEqual([false, true, false]);
    expect(filledOf('a "repos/o/r/$" b')).toEqual([false, true, false]);
    expect(filledOf("a repos/o/r/$\\\nP")).toEqual([false, true]);
    expect(filledOf("a repos/o/r/$", "powershell")).toEqual([false, true]);
    expect(filledOf("a repos/o/r/$`\nP", "powershell")).toEqual([false, true]);
    // Single quotes and an escaped `$` still fill nothing.
    expect(filledOf("a 'repos/o/r/$' \\$")).toEqual([false, false, false]);
  });

  test("bash: one filled piece makes the whole word filled", () => {
    expect(filledOf("'a$b'$c")).toEqual([true]);
    expect(filledOf("'a$b'c")).toEqual([false]);
    expect(filledOf("query='query($n: Int!) { x }'\"$S\"")).toEqual([true]);
  });

  test("PowerShell: bare and double-quoted $ is filled, single quotes and `$ are not", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell text, read by the lexer under test.
    expect(filledOf('a $x $(Get-Q) ${x} "$n" "q=$($x)"', "powershell")).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(filledOf("a '$n' 'it''s $n' \"`$n\" `$n", "powershell")).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    // The backtick is PowerShell's escape, never an expansion.
    expect(filledOf('a `x "`x"', "powershell")).toEqual([false, false, false]);
  });
});

describe("invocationsOf — the filled words of each command (IX3)", () => {
  const gh = (line: string, dialect?: "bash" | "powershell") =>
    invocationsOf(line, dialect).filter((one) => one.program === "gh");

  test("a command lists the texts of its words the shell fills", () => {
    const [run] = gh("gh api graphql -f query='query($n: Int!) { x }' -F n=\"$N\"");
    expect(run?.filled).toEqual(["n=$N"]);
    expect(run?.args).toContain("query=query($n: Int!) { x }");
  });

  test("bash -c '…' reads its string again: its own quotes decide", () => {
    const [literal] = gh(`bash -c "gh api graphql -f query='query(\\$n: Int!) { x }'"`);
    expect(literal?.filled).toEqual([]);
    const [inner] = gh(`bash -c 'gh api graphql -f query="$Q"'`);
    expect(inner?.filled).toEqual(["query=$Q"]);
  });

  test("a string the outer shell filled in is filled all through, whatever its inner quotes", () => {
    const [run] = gh(`bash -c "gh api -X POST 'repos/o/r/$K/5/comments'"`);
    expect(run?.filled).toContain("repos/o/r/$K/5/comments");
    const [piped] = gh(`echo "gh api -X POST 'repos/o/r/$K/5/comments'" | bash`);
    expect(piped?.filled).toContain("repos/o/r/$K/5/comments");
    const [evaled] = gh(`eval "gh api 'repos/o/r/$K/x'"`);
    expect(evaled?.filled).toContain("repos/o/r/$K/x");
  });

  test("a here-doc script: quoted is read as written, unquoted is filled in first", () => {
    const [quoted] = gh("bash <<'EOF'\ngh api 'repos/o/r/$K/x'\nEOF");
    expect(quoted?.filled).toEqual([]);
    const [open] = gh("bash <<EOF\ngh api 'repos/o/r/$K/x'\nEOF");
    expect(open?.filled).toContain("repos/o/r/$K/x");
    const [plain] = gh("bash <<EOF\ngh api 'repos/o/r/x'\nEOF");
    expect(plain?.filled).toEqual([]);
  });
});
