/**
 * The Windows desktop alert: a toast through the WinRT notification platform, from
 * PowerShell, with a notification-area balloon as the fallback.
 *
 * Which PowerShell: `powershell` is Windows PowerShell 5.1, which ships with Windows 10 and
 * 11 and can load WinRT types. PowerShell 7 (`pwsh`) cannot load them without extra
 * assemblies, so it is never used, and never looked for.
 *
 * Why an encoded command: the title and the body carry a person's text (a session name, a
 * turn's last answer), and they must not be able to change the program. So they are written
 * into the script as PowerShell **single-quoted strings** — inside those every character but
 * `'` is literal (`$`, a backtick, a quote, a line break: all literal), and `'` is doubled —
 * and the whole script is passed as `-EncodedCommand` (base64 of UTF-16LE), so even the
 * script's own punctuation never reaches a command line a shell parses. In the toast XML
 * they become text nodes (`CreateTextNode`), never XML source, so no character of them is
 * read as markup either. `oneLine` (`src/gateway/plain-text.ts`) already strips controls,
 * but nothing here depends on that.
 *
 * The AppUserModelID: an unpackaged app can show a toast only under an AUMID that a Start
 * Menu shortcut registers, and `TOAST_APP_ID` is PowerShell's own, which every Windows
 * 10/11 install has. The notification then shows "Windows PowerShell" as its app name.
 *
 * The balloon fallback: `NotifyIcon.ShowBalloonTip` needs no AUMID and no module, but the
 * icon must stay alive while the shell picks the balloon up, so that path waits a few
 * seconds before it exits. It runs only when the toast itself threw.
 */
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

/** `text` as a PowerShell single-quoted literal: only `'` needs anything (`''`). */
export function powershellLiteral(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
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
    `$title = ${powershellLiteral(title)}`,
    `$body = ${powershellLiteral(body)}`,
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
