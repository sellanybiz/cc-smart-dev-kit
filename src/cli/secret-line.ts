/**
 * One secret line, as a terminal or a pipe handed it to a command: the browser's token, the
 * gateway's OmniRoute key, its dashboard password, the Tavily key.
 *
 * WHY THE CLEANING (live, 2026-10-17). Many terminals (Warp among them) wrap a PASTE in the
 * bracketed-paste markers `ESC[200~` … `ESC[201~`. The shell turns that mode ON in the terminal
 * and nothing turns it off, so a command that reads the line with its own raw-mode read
 * (`readSecretLine`) receives the markers as text: the pasted token arrived as
 * `ESC[200~<token>ESC[201~`, its shape check refused it, and the person read "the token was not
 * saved" after pasting a perfectly good token. The whole line must therefore pass through
 * `cleanSecretLine` before anything judges it:
 *
 *   1. the two markers as SEQUENCES first — dropping every control character first would leave
 *      `[200~` behind and hand a longer text to the shape check;
 *   2. then every other control character (a bare CR a paste may carry, an ESC of some sequence
 *      no terminal here sends);
 *   3. then the ends trimmed.
 *
 * Printable characters stay exactly as they are: a dashboard password may hold any of them, a
 * non-ASCII letter included.
 *
 * ONE HOME: every command that takes a secret on stdin cleans with this, `readSecretLine` cleans
 * the line it read, and the browser's own parser cleans again (a paste may reach it from the
 * portal too). The two installers cannot import it — `install.sh` has `clean_secret`, `install.ps1`
 * has `Clear-Secret`, and both strip the same two markers: keep the three in step.
 */

/** The bracketed-paste markers a terminal wraps a paste in. */
export const PASTE_START = "\u001b[200~";
export const PASTE_END = "\u001b[201~";

/** Every control (`\p{Cc}`) and format (`\p{Cf}`) character: none of them belongs in a secret. */
const CONTROL = /[\p{Cc}\p{Cf}]/gu;

/** `text` as one secret line, with the paste markers and every other control character gone. */
export function cleanSecretLine(text: string): string {
  return text.replaceAll(PASTE_START, "").replaceAll(PASTE_END, "").replace(CONTROL, "").trim();
}

/** A terminal's raw input, as `readSecretLine` needs it. */
export interface RawTerminal {
  on: (event: "data", listener: (chunk: Buffer) => void) => void;
  off: (event: "data", listener: (chunk: Buffer) => void) => void;
  setRawMode?: (on: boolean) => void;
  /**
   * Stops the reading that `on("data")` started. Without it a terminal's stdin keeps the process
   * alive after the command is done (seen on a real pty, 2026-10-23: `gateway setup` asked its
   * questions, then never exited).
   */
  pause?: () => void;
}

/**
 * One line from a terminal, with NO echo: a secret must not be shown while it is typed (a
 * terminal echoes what it receives, so raw mode is switched on for the read and off after it).
 * Enter ends the line; Backspace deletes; Ctrl+C gives up and answers null. Nothing is printed.
 * The line is cleaned (`cleanSecretLine`): a paste wrapped in the bracketed-paste markers reaches
 * a raw-mode read with those markers in it.
 */
export function readSecretLine(terminal: RawTerminal): Promise<null | string> {
  return new Promise((done) => {
    let text = "";
    const listener = (chunk: Buffer) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") {
          terminal.off("data", listener);
          terminal.pause?.();
          terminal.setRawMode?.(false);
          done(cleanSecretLine(text));
          return;
        }
        if (character === "\u0003") {
          // Ctrl+C: give the terminal back as it was, and answer nothing.
          terminal.off("data", listener);
          terminal.pause?.();
          terminal.setRawMode?.(false);
          done(null);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          text = text.slice(0, -1);
          continue;
        }
        text += character;
      }
    };
    terminal.setRawMode?.(true);
    terminal.on("data", listener);
  });
}

/**
 * Can this stdin be read as a secret: a terminal that can switch its own echo off? A terminal
 * without `setRawMode` would show the secret on screen while it is typed, so that one is refused
 * (the pipe path is the way in then).
 */
export function canHideInput(stdin: { isTTY?: boolean; setRawMode?: unknown }): boolean {
  return stdin.isTTY === true && typeof stdin.setRawMode === "function";
}
