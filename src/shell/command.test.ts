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
  nestedCommand,
  nestedDialect,
  programsOf,
  readingsOf,
  redirectionTargets,
  shellSegments,
  shellSteps,
  withoutRedirections,
  wordsOf,
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
      { text: "echo hi ", pipedFrom: null },
      { text: " sh", pipedFrom: "echo hi " },
      { text: " ls", pipedFrom: null },
    ]);
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
