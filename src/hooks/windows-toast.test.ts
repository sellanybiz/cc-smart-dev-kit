/**
 * The Windows desktop alert (`windows-toast.ts`). The script cannot run here (which is not
 * Windows), so every test reads it back out of the command — the `-EncodedCommand` argument,
 * base64 of UTF-16LE — and asserts the text it holds. What matters most here: a person's
 * text cannot change the program, and cannot put itself on the command line.
 */
import { describe, expect, test } from "bun:test";
import {
  powershellLiteral,
  TOAST_SHELL,
  windowsToastArgv,
  windowsToastArgvFor,
  windowsToastScript,
} from "./windows-toast";

const SHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

/** The script back out of a command's `-EncodedCommand` argument. */
function scriptOf(argv: string[]): string {
  return Buffer.from(argv[4] ?? "", "base64").toString("utf16le");
}

describe("the command", () => {
  test("PowerShell, no profile, and the whole script as one encoded argument", () => {
    const argv = windowsToastArgv(SHELL, "Claude finished · rel", "I finished the work.");
    expect(argv.slice(0, 4)).toEqual([SHELL, "-NoProfile", "-NonInteractive", "-EncodedCommand"]);
    expect(argv).toHaveLength(5);
    // `scriptOf` reads argv[4] as base64 of UTF-16LE: if either changed, this text is garbage.
    const script = scriptOf(argv);
    expect(script).toStartWith(
      "$ErrorActionPreference = 'Stop'\n$title = 'Claude finished · rel'\n",
    );
    expect(script).toContain("$body = 'I finished the work.'\n");
    expect(script).toContain(
      "$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'\n",
    );
    expect(script).toContain(
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]::CreateToastNotifier($appId).Show($toast)\n",
    );
    expect(script).toContain("$null = $texts.Item(0).AppendChild($xml.CreateTextNode($title))\n");
    expect(script).toContain("$null = $texts.Item(1).AppendChild($xml.CreateTextNode($body))\n");
  });

  test("no text of the alert is on the command line: it is inside the encoded script", () => {
    const argv = windowsToastArgv(SHELL, "Claude finished", "the 'answer' & more");
    // The base64 alphabet has no quote, no space: nothing here can start a new token.
    expect(argv.join(" ")).not.toContain("answer");
    expect(argv.join(" ")).not.toContain("'");
    expect(scriptOf(argv)).toContain("$body = 'the ''answer'' & more'\n");
  });

  test("critical: the reminder scenario; plain: the ordinary toast", () => {
    const urgent = scriptOf(windowsToastArgv(SHELL, "t", "b", true));
    expect(urgent).toContain('$xml.LoadXml(\'<toast scenario="reminder">');
    const plain = scriptOf(windowsToastArgv(SHELL, "t", "b"));
    expect(plain).toContain("$xml.LoadXml('<toast><visual>");
    expect(plain).not.toContain("scenario=");
  });

  test("the WinRT toast is not available: a balloon, kept alive, and one line if even that fails", () => {
    const script = scriptOf(windowsToastArgv(SHELL, "t", "b"));
    expect(script).toContain(
      "} catch {\n  try {\n    Add-Type -AssemblyName System.Windows.Forms\n",
    );
    expect(script).toContain("$balloon.Visible = $true\n");
    expect(script).toContain("$balloon.ShowBalloonTip(10000)\n");
    expect(script).toContain("Start-Sleep -Milliseconds 4000\n");
    expect(script).toContain("[Console]::Error.WriteLine(");
    expect(script).toContain("exit 1\n");
  });

  test("windowsToastArgvFor: the shell this plugin looks for, with no path of its own", () => {
    expect(windowsToastArgvFor("t", "b")[0]).toBe(TOAST_SHELL);
    expect(TOAST_SHELL).toBe("powershell");
  });
});

describe("what a person's text can and cannot do to the script", () => {
  test("a quote is doubled: it cannot end the string, so no text can run", () => {
    const argv = windowsToastArgv(SHELL, "it's", "x'; Remove-Item -Recurse -Force C:\\ ; '");
    const script = scriptOf(argv);
    expect(script).toContain("$title = 'it''s'\n");
    expect(script).toContain("$body = 'x''; Remove-Item -Recurse -Force C:\\ ; '''\n");
  });

  test("a `$`, a backtick, a double quote and a line break stay inside the single quotes", () => {
    const script = scriptOf(
      windowsToastArgv(SHELL, 'a $env:USERNAME `whoami` "b"', "one\ntwo $(run)"),
    );
    // PowerShell substitutes nothing in a single-quoted string, and a line break in one does
    // not end it: all of this is text, not code.
    expect(script).toContain("$title = 'a $env:USERNAME `whoami` \"b\"'\n");
    expect(script).toContain("$body = 'one\ntwo $(run)'\n");
  });

  test("powershellLiteral: only the quote is escaped", () => {
    expect(powershellLiteral("plain")).toBe("'plain'");
    expect(powershellLiteral("a'b")).toBe("'a''b'");
    expect(powershellLiteral("''")).toBe("''''''");
    expect(powershellLiteral('$x `y` "z" \n')).toBe("'$x `y` \"z\" \n'");
    expect(powershellLiteral("")).toBe("''");
  });

  test("windowsToastScript is what the command carries", () => {
    expect(scriptOf(windowsToastArgv(SHELL, "t", "b", true))).toBe(
      windowsToastScript("t", "b", true),
    );
  });
});
