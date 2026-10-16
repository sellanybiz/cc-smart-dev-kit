/**
 * The Windows desktop alert: a toast through the WinRT notification platform, from
 * PowerShell, with a notification-area balloon as the fallback.
 *
 * Which PowerShell: `powershell` is Windows PowerShell 5.1, which ships with Windows 10 and
 * 11 and can load WinRT types. PowerShell 7 (`pwsh`) cannot load them without extra
 * assemblies, so it is never used, and never looked for.
 *
 * Why base64: the title and the body carry a person's text (a session name, a turn's last
 * answer), and they must not be able to change the program. **No character of them is part
 * of the script's own source**: each is written as the base64 of its UTF-8 bytes and decoded
 * by the script itself (`[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(…))`).
 * The base64 alphabet is `A–Z a–z 0–9 + / =`: no quote, no backslash, no line break, so
 * nothing in the text can end a string or start a new statement.
 *
 * A PowerShell single-quoted literal is **not** enough, which is what this used to do:
 * PowerShell's tokenizer reads five characters as a single quote — `'`, U+2018, U+2019,
 * U+201A and U+201B — and only the first was doubled, so a body like `don’t` ended the
 * string and the toast never showed, while `’; Start-Process calc; ’` ran code that came
 * from a web page through a model's answer (`about_Quoting_Rules` § Including quote
 * characters in a string: "PowerShell interprets smart quotation marks … as normal quotation
 * marks"; the tokenizer's own `SpecialChars` list, PowerShell source). `powershellLiteral`
 * doubles all five now, and is left for the script's own constants (the app id).
 *
 * The whole script travels as `-EncodedCommand` (base64 of UTF-16LE), so even the script's
 * own punctuation never reaches a command line a shell parses. In the toast XML the title
 * and the body become text nodes (`CreateTextNode`), never XML source, so no character of
 * them is read as markup either. `oneLine` (`src/gateway/plain-text.ts`) already strips
 * controls, but nothing here depends on that.
 *
 * The AppUserModelID: an unpackaged app can show a toast only under an AUMID that a Start
 * Menu shortcut registers, and `TOAST_APP_ID` is PowerShell's own, which every Windows
 * 10/11 install has. The notification then shows "Windows PowerShell" as its app name.
 *
 * The balloon fallback: `NotifyIcon.ShowBalloonTip` needs no AUMID and no module, but the
 * icon must stay alive while the shell picks the balloon up, so that path waits a few
 * seconds before it exits. It runs only when the toast itself threw.
 */
import { powershellLiteral } from "../shell/powershell";

/**
 * The program the toast runs in: `powershell` is Windows PowerShell 5.1, which ships with
 * Windows 10 and 11. It is looked for by this name, the way the Windows process scan
 * (`src/worktrees/machine-facts.ts`) already looks for it.
 */
export const TOAST_SHELL = "powershell";

/**
 * PowerShell's own AppUserModelID: the Start Menu shortcut "Windows PowerShell" registers
 * it on every Windows 10/11 install. A toast under it shows that app name.
 */
export const TOAST_APP_ID =
  "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

/**
 * `text` as the script's own base64: its UTF-8 bytes in the base64 alphabet
 * (`A–Z a–z 0–9 + / =`), which holds no quote, no backslash and no line break — so nothing
 * in `text` can end a string or start a new statement.
 */
export function base64Literal(text: string): string {
  return `'${Buffer.from(text, "utf8").toString("base64")}'`;
}

/** The PowerShell that turns `text` back into the string: base64 → UTF-8. */
function decodedText(text: string): string {
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(${base64Literal(text)}))`;
}

/**
 * The words of a `$title` / `$body` assignment in a script this module built, read back the
 * way PowerShell reads them: the base64 literal, decoded as UTF-8. `null` when the script has
 * no such statement — one that only looks like the right script is not one.
 *
 * It is the inverse of `decodedText` and the one place that knows the statement's shape, so a
 * test of an alert whose argv went through this module (`notify.ts`, `stop-failure.ts`,
 * `update/apply.ts`) does not have to repeat it.
 */
export function decodedToastText(script: string, variable: "body" | "title"): null | string {
  const found = new RegExp(
    `^\\$${variable} = \\[Text\\.Encoding\\]::UTF8\\.GetString\\(\\[Convert\\]::FromBase64String\\('([A-Za-z0-9+/=]*)'\\)\\)$`,
    "m",
  ).exec(script);
  return found === null ? null : Buffer.from(found[1] ?? "", "base64").toString("utf8");
}

/**
 * The script the toast runs. `critical` shows a **reminder** toast: it stays on screen
 * until the person dismisses it, and it reaches them with Focus Assist on — the Windows
 * counterpart of Linux's `notify-send --urgency=critical`.
 */
export function windowsToastScript(title: string, body: string, critical: boolean): string {
  const scenario = critical ? ' scenario="reminder"' : "";
  return [
    "$ErrorActionPreference = 'Stop'",
    `$title = ${decodedText(title)}`,
    `$body = ${decodedText(body)}`,
    `$appId = ${powershellLiteral(TOAST_APP_ID)}`,
    "try {",
    "  $xml = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]::New()",
    `  $xml.LoadXml('<toast${scenario}><visual><binding template="ToastGeneric"><text id="1" /><text id="2" /></binding></visual></toast>')`,
    "  $texts = $xml.GetElementsByTagName('text')",
    "  $null = $texts.Item(0).AppendChild($xml.CreateTextNode($title))",
    "  $null = $texts.Item(1).AppendChild($xml.CreateTextNode($body))",
    "  $toast = [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]::New($xml)",
    "  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]::CreateToastNotifier($appId).Show($toast)",
    "} catch {",
    "  try {",
    "    Add-Type -AssemblyName System.Windows.Forms",
    "    Add-Type -AssemblyName System.Drawing",
    "    $balloon = New-Object System.Windows.Forms.NotifyIcon",
    "    $balloon.Icon = [System.Drawing.SystemIcons]::Information",
    "    $balloon.BalloonTipTitle = $title",
    "    $balloon.BalloonTipText = $body",
    "    $balloon.Visible = $true",
    "    $balloon.ShowBalloonTip(10000)",
    "    Start-Sleep -Milliseconds 4000",
    "    $balloon.Dispose()",
    "  } catch {",
    "    [Console]::Error.WriteLine('cc-smart-dev-kit: the desktop notification could not be shown: ' + $_.Exception.Message)",
    "    exit 1",
    "  }",
    "}",
  ].join("\n");
}

/**
 * The command that shows `title` and `body` as a Windows toast: `shell` (the PowerShell
 * found on PATH) and the script as `-EncodedCommand`, so no text of the alert is on the
 * command line.
 */
export function windowsToastArgv(
  shell: string,
  title: string,
  body: string,
  critical = false,
): string[] {
  const script = windowsToastScript(title, body, critical);
  return [
    shell,
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ];
}

/** The same, with the shell this plugin looks for (`TOAST_SHELL`). */
export function windowsToastArgvFor(title: string, body: string, critical = false): string[] {
  return windowsToastArgv(TOAST_SHELL, title, body, critical);
}
