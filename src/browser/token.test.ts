/**
 * The extension's token: its shape (the extension's own 43 URL-safe characters, and the
 * `PLAYWRIGHT_MCP_EXTENSION_TOKEN=` line its Copy button puts on the clipboard), the 0600 file it
 * lives in, and the no-echo read from a terminal. No token value is ever printed by the code under
 * test; the fixtures here are made-up ones.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import {
  BROWSER_TOKEN_ENV,
  canHideInput,
  clearBrowserToken,
  isBrowserToken,
  parseBrowserToken,
  readBrowserToken,
  readSecretLine,
  readTokenFromStdin,
  writeBrowserToken,
} from "./token";

/** 43 URL-safe characters: the extension's own shape (32 random bytes, base64, made URL-safe). */
const TOKEN = `${"A".repeat(40)}_-b`;

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
});

describe("the token file", () => {
  test("written 0600 in a folder only its owner can read, and read back", () => {
    const home = tempDir("token");
    const paths_ = paths(home);
    writeBrowserToken(paths_, TOKEN);
    expect(readFileSync(paths_.browserTokenFile, "utf8")).toBe(`${TOKEN}\n`);
    expect(statSync(paths_.browserTokenFile).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, ".config", "cc-smart-dev-kit")).mode & 0o777).toBe(0o700);
    expect(readBrowserToken(paths_)).toEqual({ source: "file", value: TOKEN });
  });

  test("a missing file says where it would be, never a token", () => {
    const paths_ = paths(tempDir("token"));
    const read = readBrowserToken(paths_);
    expect(read.source).toBe("none");
    if (read.source === "none")
      expect(read.reason).toBe(`no token file at ${paths_.browserTokenFile}`);
  });

  test("a file others can read is refused, with the command that fixes it", () => {
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
