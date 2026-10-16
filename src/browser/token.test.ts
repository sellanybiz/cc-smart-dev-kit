/**
 * The extension's token: its shape (the extension's own 43 URL-safe characters, and the
 * `PLAYWRIGHT_MCP_EXTENSION_TOKEN=` line its Copy button puts on the clipboard), the bracketed
 * paste a terminal wraps a paste in, the 0600 file it lives in, and the no-echo read from a
 * terminal. No token value is ever printed by the code under test; the fixtures here are
 * made-up ones.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { canHideInput, PASTE_END, PASTE_START, readSecretLine } from "../cli/secret-line";
import { tempDir } from "../testing/temp";
import {
  BROWSER_TOKEN_ENV,
  clearBrowserToken,
  isBrowserToken,
  parseBrowserToken,
  readBrowserToken,
  readTokenFromStdin,
  savePastedToken,
  tokenProtection,
  tokenSavedLine,
  writeBrowserToken,
} from "./token";

/** 43 URL-safe characters: the extension's own shape (32 random bytes, base64, made URL-safe). */
const TOKEN = `${"A".repeat(40)}_-b`;

/** Windows makes the modes up (`statSync().mode` is 0666 for a writable file): POSIX assertions. */
const NO_POSIX_MODES = process.platform === "win32";

function paths(home: string) {
  return cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
}

describe("parseBrowserToken", () => {
  test("the token itself, and the whole line the Copy button copies", () => {
    expect(isBrowserToken(TOKEN)).toBe(true);
    expect(parseBrowserToken(TOKEN)).toEqual({ ok: true, token: TOKEN });
    expect(parseBrowserToken(`  ${TOKEN}\n`)).toEqual({ ok: true, token: TOKEN });
    expect(parseBrowserToken(`${BROWSER_TOKEN_ENV}=${TOKEN}`)).toEqual({ ok: true, token: TOKEN });
    expect(parseBrowserToken(`  ${BROWSER_TOKEN_ENV}=${TOKEN}\n`)).toEqual({
      ok: true,
      token: TOKEN,
    });
  });

  test("a half-copied or wrong-shaped token is refused, naming the shape", () => {
    const short = parseBrowserToken(TOKEN.slice(0, 30));
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.why).toContain("43");
    // 32 bytes of base64 keep one `=`: pasted with it, the token is not the extension's.
    expect(parseBrowserToken(`${TOKEN}=`).ok).toBe(false);
    expect(parseBrowserToken(TOKEN.replace("A", "+")).ok).toBe(false);
    expect(parseBrowserToken(TOKEN.replace("A", "/")).ok).toBe(false);
  });

  test("nothing pasted", () => {
    expect(parseBrowserToken("")).toEqual({
      ok: false,
      why: "nothing was pasted. Copy the token from the extension's status page",
    });
    expect(parseBrowserToken(`${BROWSER_TOKEN_ENV}=`).ok).toBe(false);
  });

  // Live, 2026-10-17: a person pasted a good token and it was never saved. Warp — and other
  // terminals — wrap a PASTE in the bracketed-paste markers, the terminal keeps that mode on
  // after the shell turns it on, and a read that echoes nothing (or a pipe) keeps every
  // character: the token arrived as ESC[200~<token>ESC[201~, the shape check refused it, and
  // the person read "the token was not saved" about a token they had just copied.
  test("a token wrapped in the bracketed-paste markers is accepted", () => {
    expect(parseBrowserToken(`${PASTE_START}${TOKEN}${PASTE_END}`)).toEqual({
      ok: true,
      token: TOKEN,
    });
    expect(parseBrowserToken(`${PASTE_START}${BROWSER_TOKEN_ENV}=${TOKEN}${PASTE_END}\n`)).toEqual({
      ok: true,
      token: TOKEN,
    });
    // Two pastes, or a marker left over in the middle: both markers go, the token stays.
    expect(
      parseBrowserToken(`${PASTE_START}${TOKEN}${PASTE_END}${PASTE_START}${PASTE_END}`),
    ).toEqual({ ok: true, token: TOKEN });
  });

  test("a token with a trailing carriage return is accepted", () => {
    // A paste from a Windows terminal, or a file written with CRLF: the CR is not part of it.
    expect(parseBrowserToken(`${TOKEN}\r\n`)).toEqual({ ok: true, token: TOKEN });
    expect(parseBrowserToken(`${PASTE_START}${TOKEN}\r${PASTE_END}\n`)).toEqual({
      ok: true,
      token: TOKEN,
    });
  });

  test("anything else is still refused, and says how many characters were left", () => {
    // `hello world` is 11 printable characters: the count the person reads is the text that
    // was left AFTER the markers and every control character went, which is what makes the
    // message useful ("43 expected, 11 counted").
    const refused = parseBrowserToken(`${PASTE_START}hello\u0007 world${PASTE_END}`);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.why).toContain("11 characters");
      expect(refused.why).not.toContain("hello");
    }
    // A paste of an escape sequence that is not the marker leaves its tail: still refused.
    expect(parseBrowserToken(`${TOKEN.slice(0, 30)}\u001b[9~`).ok).toBe(false);
  });
});

describe("the token file", () => {
  test("written and read back: the file holds the token, never a newline's worth more", () => {
    const home = tempDir("token");
    const paths_ = paths(home);
    writeBrowserToken(paths_, TOKEN);
    expect(readFileSync(paths_.browserTokenFile, "utf8")).toBe(`${TOKEN}\n`);
    expect(readBrowserToken(paths_)).toEqual({ source: "file", value: TOKEN });
  });

  test.skipIf(NO_POSIX_MODES)("written 0600 in a folder only its owner can read", () => {
    const home = tempDir("token");
    const paths_ = paths(home);
    writeBrowserToken(paths_, TOKEN);
    expect(statSync(paths_.browserTokenFile).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, ".config", "cc-smart-dev-kit")).mode & 0o777).toBe(0o700);
  });

  test("a missing file says where it would be, never a token", () => {
    const paths_ = paths(tempDir("token"));
    const read = readBrowserToken(paths_);
    expect(read.source).toBe("none");
    if (read.source === "none")
      expect(read.reason).toBe(`no token file at ${paths_.browserTokenFile}`);
  });

  test.skipIf(NO_POSIX_MODES)(
    "a file others can read is refused, with the command that fixes it",
    () => {
      const home = tempDir("token");
      const paths_ = paths(home);
      writeBrowserToken(paths_, TOKEN);
      chmodSync(paths_.browserTokenFile, 0o644);
      const read = readBrowserToken(paths_);
      expect(read.source).toBe("none");
      if (read.source === "none") {
        expect(read.reason).toContain("readable by others");
        expect(read.reason).toContain(`chmod 600 ${paths_.browserTokenFile}`);
        expect(read.reason).not.toContain(TOKEN);
      }
    },
  );

  test("the same shared-looking file: refused off Windows, read on Windows", () => {
    // Windows reports 0o100666 for a writable file whatever its ACL says, so the bits cannot
    // decide there: the profile's ACL protects the token file, and refusing every file would
    // leave `browser mcp` saying "readable by others (mode 666)" on every Windows machine.
    const home = tempDir("token");
    const paths_ = paths(home);
    writeBrowserToken(paths_, TOKEN);
    chmodSync(paths_.browserTokenFile, 0o666);
    expect(readBrowserToken(paths_, {}, "linux").source).toBe("none");
    expect(readBrowserToken(paths_, {}, "darwin").source).toBe("none");
    expect(readBrowserToken(paths_, {}, "win32")).toEqual({ source: "file", value: TOKEN });
  });

  test("an empty or wrong-shaped file is refused, and the reason never holds a value", () => {
    const home = tempDir("token");
    const paths_ = paths(home);
    mkdirSync(join(home, ".config", "cc-smart-dev-kit"), { recursive: true, mode: 0o700 });
    writeFileSync(paths_.browserTokenFile, "\n", { mode: 0o600 });
    const empty = readBrowserToken(paths_);
    expect(empty.source).toBe("none");
    if (empty.source === "none") expect(empty.reason).toContain("is empty");

    writeFileSync(paths_.browserTokenFile, "not-a-token\n", { mode: 0o600 });
    const wrong = readBrowserToken(paths_);
    expect(wrong.source).toBe("none");
    if (wrong.source === "none") {
      expect(wrong.reason).toContain("does not hold the extension's token");
      expect(wrong.reason).not.toContain("not-a-token");
    }
  });

  test("clear removes it, and says nothing when there was none", () => {
    const home = tempDir("token");
    const paths_ = paths(home);
    expect(clearBrowserToken(paths_)).toBeNull();
    writeBrowserToken(paths_, TOKEN);
    expect(clearBrowserToken(paths_)).toBe(paths_.browserTokenFile);
    expect(clearBrowserToken(paths_)).toBeNull();
  });
});

describe("reading the token from a terminal", () => {
  /** A terminal that answers with the given chunks, and records the raw-mode calls. */
  function fakeTerminal(chunks: string[]): {
    modes: boolean[];
    terminal: {
      on: (event: "data", listener: (chunk: Buffer) => void) => void;
      off: (event: "data", listener: (chunk: Buffer) => void) => void;
      setRawMode: (on: boolean) => void;
    };
  } {
    let listener: ((chunk: Buffer) => void) | undefined;
    const modes: boolean[] = [];
    const terminal = {
      off: () => {
        listener = undefined;
      },
      on: (_event: "data", next: (chunk: Buffer) => void) => {
        listener = next;
        // The terminal answers once the read has begun, as a real one does.
        queueMicrotask(() => {
          for (const chunk of chunks) listener?.(Buffer.from(chunk, "utf8"));
        });
      },
      setRawMode: (on: boolean) => {
        modes.push(on);
      },
    };
    return { modes, terminal };
  }

  test("Enter ends the line, Backspace deletes, and the terminal is left as it was", async () => {
    const { modes, terminal } = fakeTerminal([
      `${TOKEN.slice(0, 20)}X`,
      "\u007f",
      `${TOKEN.slice(20)}\r`,
    ]);
    expect(await readSecretLine(terminal)).toBe(TOKEN);
    expect(modes).toEqual([true, false]);
  });

  test("Ctrl+C gives up, and the terminal is left as it was", async () => {
    const { modes, terminal } = fakeTerminal(["\u0003"]);
    expect(await readSecretLine(terminal)).toBeNull();
    expect(modes).toEqual([true, false]);
  });

  test("a paste arrives with the bracketed-paste markers in it, and the read hands them back clean", async () => {
    // The terminal wraps a paste while bracketed paste is on, and a raw-mode read keeps every
    // character: the line this returns must be the token itself.
    const { terminal } = fakeTerminal([`${PASTE_START}${TOKEN}${PASTE_END}\r`]);
    expect(await readSecretLine(terminal)).toBe(TOKEN);
  });

  test("a paste wrapped over two chunks is still one clean line", async () => {
    // A paste can arrive in pieces: the markers may sit in either chunk.
    const { terminal } = fakeTerminal([PASTE_START, TOKEN, `${PASTE_END}\r`]);
    expect(await readSecretLine(terminal)).toBe(TOKEN);
  });

  test("a terminal whose echo cannot be switched off is refused, never read", async () => {
    // `readAll` on a terminal would wait for Ctrl+D and show the token: the one thing this must
    // not do, so it throws and the caller says to pipe the token in instead.
    await expect(
      readTokenFromStdin({ isTTY: true, readAll: () => Promise.resolve("") }, () => undefined),
    ).rejects.toThrow("cannot hide what you type");
    expect(canHideInput({ isTTY: true, setRawMode: () => undefined })).toBe(true);
    expect(canHideInput({ isTTY: true })).toBe(false);
    expect(canHideInput({ isTTY: false, setRawMode: () => undefined })).toBe(false);
    expect(canHideInput({})).toBe(false);
  });

  test("a terminal is read with no echo; a pipe is read as it is", async () => {
    const said: string[] = [];
    const fromSecret = await readTokenFromStdin(
      {
        isTTY: true,
        readAll: () => Promise.resolve("from-the-pipe"),
        readSecret: () => Promise.resolve(TOKEN),
      },
      (line) => said.push(line),
    );
    expect(fromSecret).toBe(TOKEN);
    expect(said.join("\n")).toContain("not shown");

    const fromPipe = await readTokenFromStdin(
      { isTTY: false, readAll: () => Promise.resolve("from-the-pipe\n") },
      (line) => said.push(line),
    );
    expect(fromPipe).toBe("from-the-pipe\n");
    // No prompt when there is nothing to hide from: a pipe already echoes nothing.
    expect(said).toHaveLength(1);
  });
});

describe("how the token file is kept to its owner, in words", () => {
  test("Linux and macOS name the mode; Windows names the profile's permissions", () => {
    expect(tokenProtection("linux")).toBe("mode 600");
    expect(tokenProtection("darwin")).toBe("mode 600");
    expect(tokenProtection("win32")).toBe("your user profile's permissions keep it yours");
  });

  test("the saved line names the file and never says mode 600 on Windows", () => {
    expect(tokenSavedLine("/h/.config/t.token", "linux")).toBe(
      "+ /h/.config/t.token: the browser token is set (mode 600)",
    );
    const windows = tokenSavedLine("C:\\Users\\u\\t.token", "win32");
    expect(windows).toBe(
      "+ C:\\Users\\u\\t.token: the browser token is set (your user profile's permissions keep it yours)",
    );
    expect(windows).not.toContain("mode 600");
  });
});

describe("savePastedToken: the four outcomes, and a read that fails", () => {
  // Low, premium review 2026-10-17: the CLI mapped EVERY failure of the read to
  // "Nothing was saved (Ctrl+C)" with exit 130 — a lie about a broken pipe or a terminal that
  // cannot hide what is typed, and a script could not tell it from a person pressing Ctrl+C.
  const TOKEN = `${"A".repeat(41)}_-`;

  function lines(): { error: string[]; said: string[] } {
    return { error: [], said: [] };
  }

  test("a good token on stdin: saved, 0600, and never printed", async () => {
    const home = tempDir("token-save");
    const paths_ = paths(home);
    const out = lines();
    const code = await savePastedToken(
      paths_,
      { isTTY: false, readAll: () => Promise.resolve(`${TOKEN}\n`) },
      (line) => out.said.push(line),
      (line) => out.error.push(line),
    );
    expect(code).toBe(0);
    expect(out.error).toEqual([]);
    expect(out.said[0]).toContain("the browser token is set");
    expect(readFileSync(paths_.browserTokenFile, "utf8")).toBe(`${TOKEN}\n`);
    expect(out.said.join("\n")).not.toContain(TOKEN);
  });

  test("a shape that is not the token: exit 1, its own reason, nothing written", async () => {
    const home = tempDir("token-shape");
    const paths_ = paths(home);
    const out = lines();
    const code = await savePastedToken(
      paths_,
      { isTTY: false, readAll: () => Promise.resolve("hello world\n") },
      (line) => out.said.push(line),
      (line) => out.error.push(line),
    );
    expect(code).toBe(1);
    expect(out.error[0]).toContain("The token was not saved");
    expect(out.error[0]).toContain("11 characters");
    expect(existsSync(paths_.browserTokenFile)).toBe(false);
  });

  test("Ctrl+C: exit 130, and nothing was written", async () => {
    const home = tempDir("token-ctrlc");
    const paths_ = paths(home);
    const out = lines();
    const code = await savePastedToken(
      paths_,
      { isTTY: true, readAll: () => Promise.resolve(""), readSecret: () => Promise.resolve(null) },
      (line) => out.said.push(line),
      (line) => out.error.push(line),
    );
    expect(code).toBe(130);
    expect(out.error).toEqual(["Nothing was saved (Ctrl+C)."]);
    expect(existsSync(paths_.browserTokenFile)).toBe(false);
  });

  test("a read that FAILS: exit 1, its own reason and the two ways in — never Ctrl+C", async () => {
    const home = tempDir("token-read-fail");
    const paths_ = paths(home);
    const out = lines();
    const code = await savePastedToken(
      paths_,
      {
        isTTY: false,
        readAll: () => Promise.reject(new Error("stdin closed badly")),
      },
      (line) => out.said.push(line),
      (line) => out.error.push(line),
    );
    expect(code).toBe(1);
    expect(out.error[0]).toContain("stdin closed badly");
    expect(out.error[0]).toContain("browser token < token.txt");
    expect(out.error[0]).toContain("cc-smart-dev-kit portal");
    expect(out.error.join("\n")).not.toContain("Ctrl+C");
    expect(existsSync(paths_.browserTokenFile)).toBe(false);
  });

  test("a terminal that cannot hide what is typed: the reason the read gave, exit 1", async () => {
    const home = tempDir("token-no-hide");
    const paths_ = paths(home);
    const out = lines();
    const code = await savePastedToken(
      paths_,
      { isTTY: true, readAll: () => Promise.resolve("") },
      (line) => out.said.push(line),
      (line) => out.error.push(line),
    );
    expect(code).toBe(1);
    expect(out.error[0]).toContain("this terminal cannot hide what you type");
    expect(out.error.join("\n")).not.toContain("Ctrl+C");
  });
});
