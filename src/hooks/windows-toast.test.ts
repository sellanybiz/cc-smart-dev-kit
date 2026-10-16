/**
 * The Windows desktop alert (`windows-toast.ts`). The script cannot run here (which is not
 * Windows), so every test reads it back out of the command — the `-EncodedCommand` argument,
 * base64 of UTF-16LE — and asserts the text it holds. What matters most here: a person's
 * text cannot change the program, no character of it reaches the script, and the script
 * decodes back exactly what went in.
 */
import { describe, expect, test } from "bun:test";
import {
  base64Literal,
  decodedToastText,
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

/** The four "smart" single quotes PowerShell's tokenizer reads as a quote as well. */
const SMART_QUOTES = ["\u2018", "\u2019", "\u201A", "\u201B"];

describe("the command", () => {
  test("PowerShell, no profile, and the whole script as one encoded argument", () => {
    const argv = windowsToastArgv(SHELL, "Claude finished · rel", "I finished the work.");
    expect(argv.slice(0, 4)).toEqual([SHELL, "-NoProfile", "-NonInteractive", "-EncodedCommand"]);
    expect(argv).toHaveLength(5);
    // `scriptOf` reads argv[4] as base64 of UTF-16LE: if either changed, this text is garbage.
    const script = scriptOf(argv);
    expect(script).toStartWith(
      "$ErrorActionPreference = 'Stop'\n$title = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('",
    );
    expect(script).toContain(
      "$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'\n",
    );
    expect(script).toContain(
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]::CreateToastNotifier($appId).Show($toast)\n",
    );
    expect(script).toContain("$null = $texts.Item(0).AppendChild($xml.CreateTextNode($title))\n");
    expect(script).toContain("$null = $texts.Item(1).AppendChild($xml.CreateTextNode($body))\n");
    // The title and the body are the ones given, read back the way the script reads them.
    expect(decodedToastText(script, "title")).toBe("Claude finished · rel");
    expect(decodedToastText(script, "body")).toBe("I finished the work.");
  });

  test("no text of the alert is in the script or on the command line", () => {
    const argv = windowsToastArgv(SHELL, "Claude finished", "the 'answer' & more");
    // The base64 alphabet has no quote, no space: nothing here can start a new token.
    expect(argv.join(" ")).not.toContain("answer");
    expect(argv.join(" ")).not.toContain("'");
    const script = scriptOf(argv);
    expect(script).not.toContain("answer");
    expect(decodedToastText(script, "body")).toBe("the 'answer' & more");
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
  test("a smart quote cannot end the string, and none of the text reaches the script", () => {
    // PowerShell's tokenizer reads U+2018, U+2019, U+201A and U+201B as a single quote too,
    // and only `'` used to be doubled: `don’t` ended the string (no toast at all), and this
    // body — text a model wrote after reading a web page — ran a program.
    const body = "don’t ‘stop’ ‚there‛ ’; Start-Process calc; ’\nnew line 🎉";
    const argv = windowsToastArgv(SHELL, "it’s", body);
    const script = scriptOf(argv);
    for (const raw of ["don’t", "Start-Process", "new line", "🎉", "it’s"]) {
      expect(script).not.toContain(raw);
    }
    for (const quote of SMART_QUOTES) expect(script).not.toContain(quote);
    // What the script carries instead is the base64 alphabet: no quote to end a string with.
    const carried = script.split("FromBase64String('")[1]?.split("'")[0] ?? "";
    expect(carried).toMatch(/^[A-Za-z0-9+/=]*$/);
    expect(decodedToastText(script, "title")).toBe("it’s");
    expect(decodedToastText(script, "body")).toBe(body);
  });

  test("a `$`, a backtick, a double quote and a line break are still only text", () => {
    const body = 'one\ntwo $(run) `whoami` "quoted"';
    const script = scriptOf(windowsToastArgv(SHELL, 'a $env:USERNAME `whoami` "b"', body));
    expect(decodedToastText(script, "title")).toBe('a $env:USERNAME `whoami` "b"');
    expect(decodedToastText(script, "body")).toBe(body);
  });

  test("base64Literal: the UTF-8 bytes, in an alphabet a quote cannot be built from", () => {
    expect(base64Literal("plain")).toBe("'cGxhaW4='");
    expect(base64Literal("’")).toBe("'4oCZ'");
    expect(base64Literal("")).toBe("''");
  });

  test("windowsToastScript is what the command carries", () => {
    expect(scriptOf(windowsToastArgv(SHELL, "t", "b", true))).toBe(
      windowsToastScript("t", "b", true),
    );
  });
});
