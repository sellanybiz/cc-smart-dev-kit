/**
 * The shell lexer (`src/shell/command.ts`): it cuts a line into the commands it RUNS, and
 * never mistakes text (quotes, here-doc bodies, comments) for a command. Every expected
 * list is written by hand. The classifier's own tests (`src/jobs/classify.test.ts`) cover
 * what it decides from these pieces.
 */
import { describe, expect, test } from "bun:test";
import { invocationOf, nestedCommand, shellSegments, wordsOf } from "./command";

describe("shellSegments — where a command ends", () => {
  test("splits at ; && || | & new lines, braces and parentheses", () => {
    expect(shellSegments("git add . && git commit -m x")).toEqual([
      "git add . ",
      "",
      " git commit -m x",
    ]);
    expect(shellSegments("a; b | c\nd")).toEqual(["a", " b ", " c", "d"]);
    expect(shellSegments("if ($?) { x }")).toEqual(["if ", "$?", " ", " x ", ""]);
  });

  test("keeps a separator inside quotes", () => {
    expect(shellSegments('git commit -m "a; b|c"')).toEqual(['git commit -m "a; b|c"']);
    expect(shellSegments("echo 'a && b'; ls")).toEqual(["echo 'a && b'", " ls"]);
    expect(shellSegments('echo "say \\"hi\\"; ls"')).toEqual(['echo "say \\"hi\\"; ls"']);
  });

  test("treats a backslash as an escape only before a quote or a backslash", () => {
    expect(shellSegments('echo \\"; ls')).toEqual(['echo \\"', " ls"]);
    // A Windows path: `D:\;` still ends the command.
    expect(shellSegments("cd D:\\; ls")).toEqual(["cd D:\\", " ls"]);
    // A PowerShell backtick escapes a quote the same way.
    expect(shellSegments('echo `"; ls')).toEqual(['echo `"', " ls"]);
  });

  test("reads $'…' with a backslash-escaped quote", () => {
    expect(shellSegments("echo $'a\\'; b'; ls")).toEqual(["echo $'a\\'; b'", " ls"]);
  });

  test("drops a # comment that starts a word, not one inside a word", () => {
    expect(shellSegments("echo hi # ; ls\npwd")).toEqual(["echo hi ", "pwd"]);
    expect(shellSegments("echo a#b; ls")).toEqual(["echo a#b", " ls"]);
    expect(shellSegments("echo $#; ls")).toEqual(["echo $#", " ls"]);
  });
});

describe("shellSegments — here-docs and here-strings", () => {
  test("drops a body up to its closing line", () => {
    expect(shellSegments("cat <<EOF\nnpm install\nEOF\nls")).toEqual(["cat <<EOF", "ls"]);
    expect(shellSegments("cat <<'EOF'\nnpm i\nEOF")).toEqual(["cat <<'EOF'", ""]);
    expect(shellSegments('cat <<"EOF" && ls\nnpm i\nEOF')).toEqual(['cat <<"EOF" ', "", " ls", ""]);
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

  test("cuts a PowerShell here-string to an empty string", () => {
    expect(shellSegments('x @"\nnpm install\n"@ | y')).toEqual(['x "" ', " y"]);
    expect(shellSegments("x @'\nnpm install\n'@")).toEqual(["x ''"]);
  });

  test("runs an unclosed here-doc to the end — or, read blind, leaves the lines", () => {
    expect(shellSegments("cat <<EOF\nls")).toEqual(["cat <<EOF", ""]);
    expect(shellSegments("cat <<EOF\nls", { blindWhenOpen: true })).toEqual(["cat <<EOF", "ls"]);
  });
});

describe("shellSegments — $( … ) inside double quotes", () => {
  test("adds its commands, ahead of the command that holds the quote", () => {
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

  test("reads a subshell inside it, and skips arithmetic", () => {
    expect(shellSegments('echo "$((ls); pwd)"')).toEqual([
      "",
      "ls",
      "",
      " pwd",
      'echo "$((ls); pwd)"',
    ]);
    expect(shellSegments('echo "$((1+2))"; ls')).toEqual(['echo "$((1+2))"', " ls"]);
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
  });
});

describe("shellSegments — a line that goes on", () => {
  test("is cut at the line break unless the lines are joined", () => {
    expect(shellSegments("a \\\n b")).toEqual(["a \\", " b"]);
    expect(shellSegments("a \\\n b", { joinLines: true })).toEqual(["a   b"]);
    expect(shellSegments("a `\n b", { joinLines: true })).toEqual(["a   b"]);
    expect(shellSegments("a \\  \r\n b", { joinLines: true })).toEqual(["a   b"]);
  });
});

describe("wordsOf, invocationOf, nestedCommand", () => {
  test("removes the quotes around a piece and keeps the ones inside", () => {
    expect(wordsOf("git commit -m \"a b\" 'c d'")).toEqual(["git", "commit", "-m", "a b", "c d"]);
    expect(wordsOf(`bash -c 'echo "x; y"'`)).toEqual(["bash", "-c", 'echo "x; y"']);
    expect(wordsOf('echo "say \\"hi\\""')).toEqual(["echo", 'say "hi"']);
    expect(wordsOf('--subject="a b"x')).toEqual(["--subject=a bx"]);
  });

  test("finds the program behind assignments and wrappers, without a folder or .exe", () => {
    expect(invocationOf(["CI=1", "sudo", "/usr/bin/gh.exe", "pr"])).toEqual({
      args: ["pr"],
      program: "gh",
    });
    expect(invocationOf(["A=1"])).toBeUndefined();
  });

  test("reads the inner command of a wrapper", () => {
    expect(nestedCommand("bash", ["-lc", "ls; pwd"])).toBe("ls; pwd");
    expect(nestedCommand("cmd", ["/c", "dir", "C:\\"])).toBe("dir C:\\");
    expect(nestedCommand("pwsh", ["-Com", "ls", "-la"])).toBe("ls -la");
    expect(nestedCommand("eval", ["ls", "a"])).toBe("ls a");
    expect(nestedCommand("git", ["-c", "x"])).toBeUndefined();
  });
});
